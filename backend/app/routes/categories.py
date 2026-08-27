# backend/app/routers/categories.py
from typing import Annotated, Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException

from ..core.security import get_current_user_id, get_current_user_id_optional
from ..db.database import cat_sections_col, categories_col, tx_col
from ..schemas.schemas import CategoryCreate, CategoryUpdate
from ..services.finance import (
    fix_id,
    get_category_scope_query,
    seed_categories_for_user,
)
from ..utils.helpers import oid

router = APIRouter(prefix="/categories", tags=["Categories"])
CurrentUserId = Annotated[str, Depends(get_current_user_id)]
OptionalCurrentUserId = Annotated[Optional[str], Depends(get_current_user_id_optional)]


@router.get("/tree")
async def get_category_tree(user_id: OptionalCurrentUserId = None):
    if user_id:
        await seed_categories_for_user(str(user_id))

    sections_raw = await cat_sections_col().find({}).to_list(100)
    all_cats_raw = (
        await categories_col().find(get_category_scope_query(user_id)).to_list(1000)
    )
    all_cats: List[Dict[str, Any]] = [
        c for c in [fix_id(raw) for raw in all_cats_raw] if isinstance(c, dict)
    ]

    def category_sort_key(item: Dict[str, Any]) -> tuple[Any, ...]:
        raw_order = item.get("order")
        try:
            return (
                (0, int(raw_order), str(item.get("name", "")).lower())
                if raw_order is not None
                else (1, 10**9, str(item.get("name", "")).lower())
            )
        except (TypeError, ValueError):
            return (1, 10**9, str(item.get("name", "")).lower())

    result = []
    for sec in sections_raw:
        sec_id = str(sec["_id"])
        main_categories = [
            c
            for c in all_cats
            if str(c.get("section_id")) == sec_id and not c.get("parent_id")
        ]
        main_categories.sort(key=category_sort_key)

        for p_cat in main_categories:
            p_id = p_cat.get("id")
            matching_subs = [
                s for s in all_cats if str(s.get("parent_id")) == str(p_id)
            ]
            matching_subs.sort(key=category_sort_key)
            p_cat["subcategories"] = matching_subs

        result.append(
            {
                "section": sec.get("name"),
                "section_id": sec_id,
                "categories": main_categories,
            }
        )
    return result


@router.post("/")
async def create_category(payload: CategoryCreate, user_id: CurrentUserId):
    await seed_categories_for_user(str(user_id))
    doc = payload.model_dump()
    doc["user_id"] = str(user_id)

    if doc.get("parent_id"):
        parent = await categories_col().find_one(
            {"_id": oid(doc["parent_id"]), **get_category_scope_query(user_id)}
        )
        if not parent:
            raise HTTPException(status_code=404, detail="Categoría padre no encontrada")
        doc["section_id"] = str(parent.get("section_id"))

    res = await categories_col().insert_one(doc)
    doc["_id"] = res.inserted_id
    return fix_id(doc)


@router.patch("/{category_id}")
async def update_category(
    category_id: str, payload: CategoryUpdate, user_id: CurrentUserId
):
    await seed_categories_for_user(str(user_id))
    existing = await categories_col().find_one(
        {"_id": oid(category_id), **get_category_scope_query(user_id)}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")

    update_doc = payload.model_dump(exclude_unset=True)
    if not update_doc:
        return fix_id(existing)

    if update_doc.get("parent_id"):
        if str(update_doc["parent_id"]) == str(category_id):
            raise HTTPException(
                status_code=400, detail="Una categoría no puede ser su propio padre"
            )
        parent = await categories_col().find_one(
            {"_id": oid(update_doc["parent_id"]), **get_category_scope_query(user_id)}
        )
        if not parent:
            raise HTTPException(status_code=404, detail="Categoría padre no encontrada")
        update_doc["section_id"] = str(parent.get("section_id"))

    await categories_col().update_one(
        {"_id": oid(category_id), **get_category_scope_query(user_id)},
        {"$set": update_doc},
    )
    updated = await categories_col().find_one(
        {"_id": oid(category_id), **get_category_scope_query(user_id)}
    )
    return fix_id(updated)


@router.delete("/{category_id}")
async def delete_category(category_id: str, user_id: CurrentUserId):
    await seed_categories_for_user(str(user_id))
    category = await categories_col().find_one(
        {"_id": oid(category_id), **get_category_scope_query(user_id)}
    )
    if not category:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")

    child_categories = (
        await categories_col()
        .find({"parent_id": str(category_id), **get_category_scope_query(user_id)})
        .to_list(200)
    )
    child_ids = [str(item["_id"]) for item in child_categories]

    category_tx_count = await tx_col().count_documents(
        {"category_id": str(category_id), "user_id": str(user_id)}
    )
    subcategory_tx_count = (
        await tx_col().count_documents(
            {"subcategory_id": {"$in": child_ids}, "user_id": str(user_id)}
        )
        if child_ids
        else 0
    )
    own_subcategory_tx_count = await tx_col().count_documents(
        {"subcategory_id": str(category_id), "user_id": str(user_id)}
    )

    if (
        category_tx_count > 0
        or subcategory_tx_count > 0
        or own_subcategory_tx_count > 0
    ):
        raise HTTPException(
            status_code=409,
            detail="No puedes eliminar una categoría o subcategoría con movimientos asociados",
        )

    if child_ids:
        await categories_col().delete_many(
            {"parent_id": str(category_id), **get_category_scope_query(user_id)}
        )

    await categories_col().delete_one(
        {"_id": oid(category_id), **get_category_scope_query(user_id)}
    )
    return {"status": "success", "message": "Categoría eliminada"}

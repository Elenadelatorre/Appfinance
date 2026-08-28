# backend/app/routers/budgets.py
from typing import Annotated, Optional
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..core.security import get_current_user_id
from ..db.database import budgets_col
from ..schemas.schemas import BudgetCreate
from ..services.finance import check_budgets_logic, fix_id, get_billing_cycle_bounds
from ..utils.helpers import oid

router = APIRouter(prefix="/budgets", tags=["Budgets"])
CurrentUserId = Annotated[str, Depends(get_current_user_id)]


def _safe_oid(val: str):
    """Convierte a ObjectId o levanta 404 si el formato es inválido."""
    try:
        return oid(val)
    except (InvalidId, ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Identificador de presupuesto inválido.",
        )


@router.post("")
async def set_budget(budget: BudgetCreate, user_id: CurrentUserId):
    doc = budget.model_dump()
    doc["user_id"] = str(user_id)

    query = {
        "user_id": str(user_id),
        "category_id": str(budget.category_id),
        "month": int(budget.month),
        "year": int(budget.year),
    }

    await budgets_col().update_one(query, {"$set": doc}, upsert=True)
    return {"status": "success", "message": "Presupuesto guardado correctamente"}


@router.get("")
async def list_budgets(
    user_id: CurrentUserId,
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None, ge=2000, le=2100),
):
    if month is None or year is None:
        start, _ = get_billing_cycle_bounds()
        month = month or start.month
        year = year or start.year

    query = {
        "user_id": str(user_id),
        "month": int(month),
        "year": int(year),
    }
    budgets = await budgets_col().find(query).to_list(length=200)
    return [fix_id(b) for b in budgets]


@router.delete("/{budget_id}")
async def delete_budget(budget_id: str, user_id: CurrentUserId):
    budget_oid = _safe_oid(budget_id)
    result = await budgets_col().delete_one(
        {"_id": budget_oid, "user_id": str(user_id)}
    )
    if result.deleted_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Presupuesto no encontrado.",
        )
    return {"status": "success", "message": "Presupuesto eliminado correctamente"}


@router.get("/check")
async def check_budgets(user_id: CurrentUserId):
    return await check_budgets_logic(user_id)

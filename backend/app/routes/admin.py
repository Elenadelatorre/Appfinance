# backend/app/routers/admin.py
from typing import Annotated
from fastapi import APIRouter, Depends

from ..core.security import get_current_user_id
from ..db.database import (
    accounts_col,
    budgets_col,
    cat_sections_col,
    categories_col,
    tx_col,
)
from ..services.finance import seed_initial_categories

router = APIRouter(prefix="/admin", tags=["Admin"])
CurrentUserId = Annotated[str, Depends(get_current_user_id)]


@router.post("/seed-defaults")
async def seed_defaults(user_id: CurrentUserId):
    await categories_col().delete_many({})
    await cat_sections_col().delete_many({})
    await seed_initial_categories()
    return {"status": "ok", "message": "Categorías recreadas correctamente"}


@router.post("/reset-user-data")
async def reset_user_data(user_id: CurrentUserId):
    await tx_col().delete_many({"user_id": str(user_id)})
    await accounts_col().delete_many({"user_id": str(user_id)})
    await budgets_col().delete_many({"user_id": str(user_id)})
    return {"status": "ok", "message": "Datos del usuario eliminados"}

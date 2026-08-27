# backend/app/routers/budgets.py
from typing import Annotated, Optional
from fastapi import APIRouter, Depends, HTTPException

from ..core.security import get_current_user_id
from ..db.database import budgets_col
from ..schemas.schemas import BudgetCreate
from ..services.finance import check_budgets_logic, fix_id, get_billing_cycle_bounds
from ..utils.helpers import oid

router = APIRouter(prefix="/budgets", tags=["Budgets"])
CurrentUserId = Annotated[str, Depends(get_current_user_id)]


@router.post("")
async def set_budget(budget: BudgetCreate, user_id: CurrentUserId):
    query = {
        "user_id": str(user_id),
        "category_id": budget.category_id,
        "month": budget.month,
        "year": budget.year,
    }
    update = {"$set": budget.model_dump()}
    await budgets_col().update_one(query, update, upsert=True)
    return {"status": "success", "message": "Presupuesto guardado"}


@router.get("")
async def list_budgets(
    user_id: CurrentUserId,
    month: Optional[int] = None,
    year: Optional[int] = None,
):
    if month is None or year is None:
        start, _ = get_billing_cycle_bounds()
        month = month or start.month
        year = year or start.year

    query = {"user_id": str(user_id), "month": month, "year": year}
    budgets = await budgets_col().find(query).to_list(200)
    return [fix_id(b) for b in budgets]


@router.delete("/{budget_id}")
async def delete_budget(budget_id: str, user_id: CurrentUserId):
    result = await budgets_col().delete_one(
        {"_id": oid(budget_id), "user_id": str(user_id)}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")
    return {"status": "success", "message": "Presupuesto eliminado"}


@router.get("/check")
async def check_budgets(user_id: CurrentUserId):
    return await check_budgets_logic(user_id)

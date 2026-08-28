# backend/app/routes.py
from fastapi import APIRouter
from .routes import (
    accounts,
    admin,
    auth,
    automations,
    budgets,
    categories,
    reminders,
    transactions,
)

router = APIRouter()
router.include_router(auth.router)
router.include_router(accounts.router)
router.include_router(categories.router)
router.include_router(transactions.router)
router.include_router(budgets.router)
router.include_router(reminders.router)
router.include_router(automations.router)
router.include_router(admin.router)

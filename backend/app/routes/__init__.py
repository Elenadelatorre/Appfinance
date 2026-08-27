# backend/app/routers/__init__.py
from fastapi import APIRouter

from .accounts import router as accounts_router
from .admin import router as admin_router
from .auth import router as auth_router
from .automations import router as automations_router
from .budgets import router as budgets_router
from .categories import router as categories_router
from .reminders import router as reminders_router
from .transactions import router as transactions_router

router = APIRouter()

router.include_router(auth_router)
router.include_router(accounts_router)
router.include_router(transactions_router)
router.include_router(categories_router)
router.include_router(budgets_router)
router.include_router(reminders_router)
router.include_router(automations_router)
router.include_router(admin_router)

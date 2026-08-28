# backend/app/routers/admin.py
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..core.security import get_current_user_id
from ..db.database import (
    accounts_col,
    budgets_col,
    categories_col,
    tx_col,
)
from ..services.finance import seed_initial_categories

router = APIRouter(prefix="/admin", tags=["Admin"])


class ResetConfirmation(BaseModel):
    confirmation_phrase: str = Field(
        ...,
        description="Frase exacta requerida para confirmar el borrado de datos históricos.",
    )


@router.post("/seed-defaults")
async def seed_defaults(user_id: str = Depends(get_current_user_id)):
    """
    Siembra categorías por defecto de forma segura.
    NO borra datos existentes para proteger el histórico.
    """
    existing_count = await categories_col().count_documents({})
    if existing_count > 0:
        return {
            "status": "warning",
            "message": "Las categorías ya existen. No se realizaron cambios para preservar tus datos.",
            "categories_count": existing_count,
        }

    await seed_initial_categories()
    return {"status": "ok", "message": "Categorías iniciales creadas correctamente"}


@router.post("/reset-user-data")
async def reset_user_data(
    payload: ResetConfirmation,
    user_id: str = Depends(get_current_user_id),
):
    """
    Borrado de datos de usuario con doble factor de confirmación explícito.
    """
    REQUIRED_PHRASE = "BORRAR-MIS-DATOS-DEFINITIVAMENTE"

    if payload.confirmation_phrase != REQUIRED_PHRASE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Confirmación inválida. Debes enviar exactamente la frase: '{REQUIRED_PHRASE}'",
        )

    uid = str(user_id)
    tx_res = await tx_col().delete_many({"user_id": uid})
    acc_res = await accounts_col().delete_many({"user_id": uid})
    bud_res = await budgets_col().delete_many({"user_id": uid})

    return {
        "status": "ok",
        "message": "Datos eliminados bajo confirmación explícita.",
        "deleted_summary": {
            "transactions": tx_res.deleted_count,
            "accounts": acc_res.deleted_count,
            "budgets": bud_res.deleted_count,
        },
    }

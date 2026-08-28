# backend/app/routers/auth.py
import logging
from typing import Annotated
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pymongo.errors import DuplicateKeyError

from ..core.security import (
    create_access_token,
    get_current_user_id,
    hash_password,
    verify_password,
)
from ..db.database import users_col
from ..schemas.schemas import ChangePasswordRequest, UserCreate, UserSettingsUpdate
from ..services.finance import fix_id, seed_categories_for_user
from ..utils.helpers import DEFAULT_USER_SETTINGS, normalize_user_settings, oid

router = APIRouter(tags=["Auth"])
logger = logging.getLogger(__name__)

CurrentUserId = Annotated[str, Depends(get_current_user_id)]
LoginForm = Annotated[OAuth2PasswordRequestForm, Depends()]


def _safe_oid(val: str):
    """Convierte a ObjectId o levanta 404 si es inválido."""
    try:
        return oid(val)
    except (InvalidId, ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Identificador de usuario no válido.",
        )


@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate):
    email = payload.email.lower().strip()
    existing = await users_col().find_one({"email": email})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ese email ya está registrado.",
        )

    doc = {
        "email": email,
        "password": hash_password(payload.password),
        "settings": dict(DEFAULT_USER_SETTINGS),
    }

    try:
        res = await users_col().insert_one(doc)
        user_id = str(res.inserted_id)

        # Sembrado inicial de categorías para el nuevo usuario
        try:
            await seed_categories_for_user(user_id)
        except Exception as exc:
            logger.warning(
                "Fallo al sembrar categorías post-registro (usuario %s): %s",
                user_id,
                exc,
            )

        token = create_access_token(user_id)
        return {"access_token": token, "token_type": "bearer"}

    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ese email ya está registrado.",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error interno registrando al usuario con email %s", email)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo completar el registro.",
        )


@router.post("/auth/login")
async def login(form: LoginForm):
    email = form.username.lower().strip()
    user = await users_col().find_one({"email": email})
    if (not user) or (not verify_password(form.password, user.get("password", ""))):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = str(user["_id"])
    token = create_access_token(user_id)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me")
async def get_me(user_id: CurrentUserId):
    user = await users_col().find_one({"_id": _safe_oid(user_id)}, {"password": 0})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado.",
        )
    user["settings"] = normalize_user_settings(user.get("settings"))
    return fix_id(user)


@router.get("/me/settings")
async def get_my_settings(user_id: CurrentUserId):
    user = await users_col().find_one({"_id": _safe_oid(user_id)}, {"settings": 1})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado.",
        )
    return normalize_user_settings(user.get("settings"))


@router.put("/me/settings")
async def update_my_settings(payload: UserSettingsUpdate, user_id: CurrentUserId):
    user_oid = _safe_oid(user_id)
    user = await users_col().find_one({"_id": user_oid}, {"settings": 1})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado.",
        )

    incoming = payload.model_dump(exclude_unset=True)
    current = normalize_user_settings(user.get("settings"))
    merged = normalize_user_settings({**current, **incoming})

    await users_col().update_one(
        {"_id": user_oid},
        {"$set": {"settings": merged}},
    )
    return merged


@router.post("/auth/change-password")
async def change_password(payload: ChangePasswordRequest, user_id: CurrentUserId):
    user_oid = _safe_oid(user_id)
    user = await users_col().find_one({"_id": user_oid})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado.",
        )

    if not verify_password(payload.current_password, user.get("password", "")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Contraseña actual incorrecta.",
        )

    if verify_password(payload.new_password, user.get("password", "")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva contraseña debe ser diferente a la actual.",
        )

    await users_col().update_one(
        {"_id": user_oid},
        {"$set": {"password": hash_password(payload.new_password)}},
    )
    return {"status": "success", "message": "Contraseña actualizada correctamente."}

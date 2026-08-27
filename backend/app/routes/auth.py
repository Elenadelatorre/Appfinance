# backend/app/routers/auth.py
import logging
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
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


@router.post("/auth/register")
async def register(payload: UserCreate):
    email = payload.email.lower().strip()
    existing = await users_col().find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Ese email ya está registrado")

    doc = {
        "email": email,
        "password": hash_password(payload.password),
        "settings": dict(DEFAULT_USER_SETTINGS),
    }
    try:
        res = await users_col().insert_one(doc)
        user_id = str(res.inserted_id)
        try:
            await seed_categories_for_user(user_id)
        except Exception as exc:
            logger.warning("seed post-register failed for user %s: %s", user_id, exc)
        token = create_access_token(str(res.inserted_id))
        return {"access_token": token, "token_type": "bearer"}
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ese email ya existe")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("register failed for email %s", email)
        raise HTTPException(
            status_code=500, detail=f"No se pudo crear el usuario: {str(exc)}"
        )


@router.post("/auth/login")
async def login(form: LoginForm):
    user = await users_col().find_one({"email": form.username.lower().strip()})
    if (not user) or (not verify_password(form.password, user["password"])):
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")

    try:
        await seed_categories_for_user(str(user["_id"]))
    except Exception as exc:
        logger.warning("seed post-login failed for user %s: %s", user.get("_id"), exc)

    token = create_access_token(str(user["_id"]))
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me")
async def get_me(user_id: CurrentUserId):
    user = await users_col().find_one({"_id": oid(user_id)}, {"password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return fix_id(user)


@router.get("/me/settings")
async def get_my_settings(user_id: CurrentUserId):
    user = await users_col().find_one({"_id": oid(user_id)}, {"settings": 1})
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return normalize_user_settings(user.get("settings"))


@router.put("/me/settings")
async def update_my_settings(payload: UserSettingsUpdate, user_id: CurrentUserId):
    user = await users_col().find_one({"_id": oid(user_id)}, {"settings": 1})
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    incoming = payload.model_dump(exclude_unset=True)
    current = normalize_user_settings(user.get("settings"))
    merged = {**current, **incoming}

    await users_col().update_one(
        {"_id": oid(user_id)},
        {"$set": {"settings": normalize_user_settings(merged)}},
    )
    return normalize_user_settings(merged)


@router.post("/auth/change-password")
async def change_password(payload: ChangePasswordRequest, user_id: CurrentUserId):
    user = await users_col().find_one({"_id": oid(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    if not verify_password(payload.current_password, user["password"]):
        raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")

    if verify_password(payload.new_password, user["password"]):
        raise HTTPException(
            status_code=400, detail="La nueva contraseña debe ser diferente a la actual"
        )

    await users_col().update_one(
        {"_id": oid(user_id)},
        {"$set": {"password": hash_password(payload.new_password)}},
    )
    return {"status": "success", "message": "Contraseña actualizada"}

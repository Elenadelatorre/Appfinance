# backend/app/core/security.py
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

logger = logging.getLogger(__name__)

# --- CONFIGURACIÓN ---
_default_secret = "dev-key-change-in-production-fixed"
SECRET_KEY = os.getenv("JWT_SECRET", _default_secret)
if not SECRET_KEY or SECRET_KEY.startswith("dev-key"):
    logger.warning(
        "⚠️ JWT_SECRET no configurado o débil. Usar variable de entorno segura en producción."
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = int(os.getenv("ACCESS_TOKEN_EXPIRE_DAYS", "30"))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


# --- FUNCIONES DE CONTRASEÑA ---


def _normalize_bcrypt_secret(p: str) -> str:
    """Normaliza contraseñas para bcrypt (máximo 72 bytes)."""
    b = p.encode("utf-8")
    if len(b) <= 72:
        return p
    return b[:72].decode("utf-8", errors="ignore")


def hash_password(p: str) -> str:
    """Hashea la contraseña con bcrypt directo."""
    if not p or not isinstance(p, str):
        raise ValueError("Contraseña inválida")
    normalized = _normalize_bcrypt_secret(p).encode("utf-8")
    try:
        hashed = bcrypt.hashpw(normalized, bcrypt.gensalt())
        return hashed.decode("utf-8")
    except Exception as e:
        logger.exception("Error hashing password")
        raise ValueError("Error al procesar la contraseña") from e


def verify_password(p: str, hashed: str) -> bool:
    """Verifica si la contraseña coincide con el hash."""
    if not p or not isinstance(p, str):
        return False
    normalized = _normalize_bcrypt_secret(p).encode("utf-8")
    try:
        return bcrypt.checkpw(normalized, hashed.encode("utf-8"))
    except Exception as e:
        logger.error("Error verificando contraseña: %s", e)
        return False


# --- FUNCIONES DE TOKEN (JWT) ---


def create_access_token(sub: str) -> str:
    """Crea un token de acceso JWT para un ID de usuario específico."""
    if not sub:
        raise ValueError("Field 'sub' cannot be empty")
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": str(sub),
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    try:
        return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    except Exception as e:
        logger.error("Error al crear token: %s", e)
        raise HTTPException(status_code=500, detail="Error creando token")


def get_current_user_id(token: str = Depends(oauth2_scheme)) -> str:
    """Dependencia para proteger rutas: extrae el ID del usuario del token."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        if not sub:
            raise ValueError("Token sin campo sub")
        return sub
    except (JWTError, ValueError) as e:
        logger.warning("Token inválido: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user_id_optional(token: str = Depends(oauth2_scheme)) -> Optional[str]:
    """Devuelve el ID del usuario si el token es válido o None si no hay sesión."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except (JWTError, ValueError):
        return None
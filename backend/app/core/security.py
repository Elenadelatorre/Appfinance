# backend/app/core/security.py
import hashlib
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
ACCESS_TOKEN_EXPIRE_MINUTES = int(
    os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 24 * 7))
)  # 7 días por defecto

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


# --- FUNCIONES DE CONTRASEÑA ---


def _prepare_password(password: str) -> bytes:
    """
    Prepara la contraseña para bcrypt de forma segura.
    Si supera los 72 bytes, aplica SHA-256 en hex digest para evitar truncados arbitrarios de UTF-8.
    """
    if not password or not isinstance(password, str):
        raise ValueError("Contraseña vacía o no válida.")

    encoded = password.encode("utf-8")
    if len(encoded) > 72:
        return hashlib.sha256(encoded).hexdigest().encode("utf-8")
    return encoded


def hash_password(password: str) -> str:
    """Genera el hash seguro de la contraseña usando bcrypt."""
    try:
        pw_bytes = _prepare_password(password)
        salt = bcrypt.gensalt(rounds=12)
        return bcrypt.hashpw(pw_bytes, salt).decode("utf-8")
    except Exception as e:
        logger.exception("Error al hashear la contraseña.")
        raise ValueError("No se pudo procesar la contraseña.") from e


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Compara la contraseña en texto plano contra el hash almacenado."""
    if not plain_password or not hashed_password or not isinstance(plain_password, str):
        return False
    try:
        pw_bytes = _prepare_password(plain_password)
        return bcrypt.checkpw(pw_bytes, hashed_password.encode("utf-8"))
    except Exception as e:
        logger.error("Error al verificar la contraseña: %s", e)
        return False


# --- FUNCIONES DE TOKEN (JWT) ---


def create_access_token(user_id: str, expires_delta: Optional[timedelta] = None) -> str:
    """Genera un JWT firmado con el ID de usuario en el claim 'sub'."""
    if not user_id:
        raise ValueError("El identificador de usuario ('sub') no puede estar vacío.")

    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))

    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }

    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user_id(token: Optional[str] = Depends(oauth2_scheme)) -> str:
    """Dependencia obligatoria para endpoints autenticados."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: Optional[str] = payload.get("sub")
        if not user_id:
            raise ValueError("Token sin 'sub'")
        return user_id
    except (JWTError, ValueError) as exc:
        logger.debug("Fallo de validación de token: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de acceso inválido o expirado.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user_id_optional(
    token: Optional[str] = Depends(oauth2_scheme),
) -> Optional[str]:
    """Dependencia opcional: extrae el ID si el token existe y es válido, o devuelve None."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except (JWTError, ValueError):
        return None

# backend/app/core/exceptions.py
# backend/app/core/exceptions.py
from typing import Any, Optional


class AppException(Exception):
    """Clase base para excepciones personalizadas de la aplicación."""

    status_code: int = 500
    default_message: str = "Ha ocurrido un error interno."

    def __init__(
        self,
        message: Optional[str] = None,
        details: Optional[Any] = None,
        error_code: Optional[str] = None,
    ):
        super().__init__(message or self.default_message)
        self.message = message or self.default_message
        self.details = details
        self.error_code = error_code or self.__class__.__name__

    def to_dict(self) -> dict[str, Any]:
        """Estructura normalizada para la respuesta JSON de error."""
        error_payload: dict[str, Any] = {
            "error": self.error_code,
            "message": self.message,
        }
        if self.details is not None:
            error_payload["details"] = self.details
        return error_payload


class BadRequestError(AppException):
    """Peticiones con parámetros inválidos o mal formados (HTTP 400)."""

    status_code = 400
    default_message = "Parámetros de petición inválidos."


class NotFoundError(AppException):
    """Recurso no encontrado (HTTP 404)."""

    status_code = 404
    default_message = "El recurso solicitado no existe."


class ForbiddenError(AppException):
    """Acceso denegado a un recurso (HTTP 403)."""

    status_code = 403
    default_message = "No tienes permisos para realizar esta acción."


class UnauthorizedError(AppException):
    """Falta de autenticación o token inválido (HTTP 401)."""

    status_code = 401
    default_message = "Autenticación requerida."

# backend/app/core/exceptions.py
class BadRequestError(Exception):
    """Excepción para peticiones con parámetros inválidos."""
    pass
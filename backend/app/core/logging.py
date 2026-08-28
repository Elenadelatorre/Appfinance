"""
Configuración de logging centralizada para la aplicación.
"""

import logging
import logging.handlers
import os
import sys
from pathlib import Path

LOG_DIR = Path(os.getenv("LOG_DIR", "logs"))

VALID_LOG_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}


def _get_log_level() -> int:
    """Obtiene y valida el nivel de logging desde variables de entorno."""
    level_name = os.getenv("LOG_LEVEL", "INFO").strip().upper()

    if level_name not in VALID_LOG_LEVELS:
        level_name = "INFO"

    return getattr(logging, level_name, logging.INFO)


def _get_safe_stream():
    """Devuelve la salida estándar para el logging."""
    return sys.stdout


def setup_logging(log_filename: str = "finance_app.log") -> logging.Logger:
    """Configura el sistema de logging para consola y archivo rotatorio."""

    log_level = _get_log_level()

    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - "
        "[%(filename)s:%(lineno)d] - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Limpiar handlers previos para evitar duplicados
    # en recargas o tests.
    if root_logger.hasHandlers():
        root_logger.handlers.clear()

    # 1. Handler para consola
    console_handler = logging.StreamHandler(_get_safe_stream())
    console_handler.setFormatter(formatter)
    console_handler.setLevel(log_level)
    root_logger.addHandler(console_handler)

    # 2. Handler para archivo rotatorio
    try:
        LOG_DIR.mkdir(exist_ok=True, parents=True)

        file_handler = logging.handlers.RotatingFileHandler(
            LOG_DIR / log_filename,
            maxBytes=10_000_000,
            backupCount=5,
            encoding="utf-8",
            errors="replace",
        )

        file_handler.setFormatter(formatter)
        file_handler.setLevel(log_level)
        root_logger.addHandler(file_handler)

    except (OSError, PermissionError) as exc:
        root_logger.warning(
            "No se pudo inicializar el log en disco (%s): %s",
            LOG_DIR / log_filename,
            exc,
        )

    # 3. Silenciar ruido de dependencias
    for lib in ("pymongo", "motor", "uvicorn.access", "urllib3"):
        logging.getLogger(lib).setLevel(logging.WARNING)

    return root_logger

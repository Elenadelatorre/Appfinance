# backend/app/core/logging.py
"""
Configuración de logging centralizada para la aplicación
"""

import io
import logging
import logging.handlers
import os
import sys
from pathlib import Path

LOG_DIR = Path(os.getenv("LOG_DIR", "logs"))


def setup_logging():
    """Configura el sistema de logging forzando UTF-8 de forma segura."""

    log_level = os.getenv("LOG_LEVEL", "INFO")

    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))
    root_logger.handlers.clear()

    # Envoltura segura con UTF-8 para consola en Windows (sin avisos de tipos)
    try:
        if hasattr(sys.stdout, "buffer"):
            stream_out = io.TextIOWrapper(
                sys.stdout.buffer,
                encoding="utf-8",
                errors="backslashreplace",
                line_buffering=True,
            )
        else:
            stream_out = sys.stdout
    except Exception:
        stream_out = sys.stdout

    console_handler = logging.StreamHandler(stream_out)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # Handler para archivo con UTF-8 explícito
    try:
        LOG_DIR.mkdir(exist_ok=True, parents=True)
        file_handler = logging.handlers.RotatingFileHandler(
            LOG_DIR / "finance_app.log",
            maxBytes=10_000_000,
            backupCount=5,
            encoding="utf-8",
            errors="replace",
        )
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)
    except (OSError, PermissionError):
        pass

    logging.getLogger("pymongo").setLevel(logging.WARNING)
    logging.getLogger("motor").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    return root_logger

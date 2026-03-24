"""
Configuración de logging centralizada para la aplicación
"""

import logging
import logging.handlers
import os
from pathlib import Path

# Crear directorio de logs si no existe
LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)


def setup_logging():
    """Configura el sistema de logging de la aplicación"""

    log_level = os.getenv("LOG_LEVEL", "INFO")

    # Formato detallado
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level))

    # Handler para archivo
    file_handler = logging.handlers.RotatingFileHandler(
        LOG_DIR / "finance_app.log", maxBytes=10_000_000, backupCount=5  # 10MB
    )
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)

    # Handler para consola
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # Reducir ruido de logs
    logging.getLogger("pymongo").setLevel(logging.WARNING)
    logging.getLogger("motor").setLevel(logging.WARNING)

    return root_logger

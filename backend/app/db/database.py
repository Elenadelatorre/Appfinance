# backend/app/db/database.py
import logging
import os
from typing import Optional
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING

logger = logging.getLogger(__name__)

load_dotenv(override=True)

# -------------------------
# CONFIGURACIÓN DE CONEXIÓN
# -------------------------
MONGO_URL = (os.getenv("MONGO_URL") or "mongodb://localhost:27017").strip()
DB_NAME = (os.getenv("DB_NAME") or "finance").strip()

client: Optional[AsyncIOMotorClient] = None
db: Optional[AsyncIOMotorDatabase] = None


def get_db() -> AsyncIOMotorDatabase:
    """Devuelve la instancia activa de la base de datos."""
    global db, client
    if db is None:
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
    return db


async def close_db_connection() -> None:
    """Cierra la conexión con MongoDB al apagar el servidor."""
    global client, db
    if client is not None:
        client.close()
        logger.info("Conexión con MongoDB cerrada.")
        client = None
        db = None


# -------------------------
# HELPERS DE COLECCIONES
# -------------------------
def users_col():
    return get_db()["users"]


def tx_col():
    return get_db()["transactions"]


def accounts_col():
    return get_db()["accounts"]


def budgets_col():
    return get_db()["budgets"]


def goals_col():
    return get_db()["goals"]


def categories_col():
    return get_db()["categories"]


def cat_sections_col():
    return get_db()["category_sections"]


def reminders_col():
    return get_db()["reminders"]


def recurring_templates_col():
    return get_db()["recurring_templates"]


def auto_rules_col():
    return get_db()["auto_rules"]


# -------------------------
# CONFIGURACIÓN DE ÍNDICES
# -------------------------
async def create_indexes() -> None:
    """Crea índices para optimizar las consultas del backend."""
    try:
        # Usuarios
        await users_col().create_index("email", unique=True)

        # Transacciones (filtrado por fecha, cuenta y categoría)
        await tx_col().create_index([("user_id", ASCENDING), ("date", DESCENDING)])
        await tx_col().create_index([("account_id", ASCENDING), ("date", DESCENDING)])
        await tx_col().create_index(
            [("user_id", ASCENDING), ("category_id", ASCENDING), ("date", DESCENDING)]
        )

        # Cuentas
        await accounts_col().create_index("user_id")

        # Presupuestos
        await budgets_col().create_index(
            [
                ("user_id", ASCENDING),
                ("category_id", ASCENDING),
                ("year", ASCENDING),
                ("month", ASCENDING),
            ],
            unique=True,
        )

        # Metas de ahorro
        await goals_col().create_index(
            [("user_id", ASCENDING), ("target_date", ASCENDING)]
        )

        # Categorías y secciones
        await categories_col().create_index(
            [
                ("user_id", ASCENDING),
                ("section_id", ASCENDING),
                ("parent_id", ASCENDING),
            ]
        )
        await cat_sections_col().create_index(
            [("user_id", ASCENDING), ("order", ASCENDING)]
        )

        # Recordatorios, recurrentes y reglas
        await reminders_col().create_index(
            [("user_id", ASCENDING), ("due_date", ASCENDING)]
        )
        await recurring_templates_col().create_index(
            [("user_id", ASCENDING), ("is_active", ASCENDING)]
        )
        await auto_rules_col().create_index(
            [("user_id", ASCENDING), ("is_active", ASCENDING), ("priority", ASCENDING)]
        )

        logger.info("✅ Índices de base de datos verificados/creados.")
    except Exception as e:
        logger.warning("⚠️ Error creando índices: %s", e)

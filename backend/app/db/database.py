# backend/app/db/database.py
import logging
import os
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING

logger = logging.getLogger(__name__)

load_dotenv(override=True)

# -------------------------
# CONFIGURACIÓN DE CONEXIÓN
# -------------------------
MONGO_URL = (os.getenv("MONGO_URL") or "mongodb://localhost:27017").strip()
DB_NAME = (os.getenv("DB_NAME") or "finance").strip()


def ensure_db_in_uri(uri: str, db_name: str) -> str:
    """Asegura que la URI de MongoDB apunte a la base de datos correcta."""
    if uri.startswith("mongodb+srv://") or uri.startswith("mongodb://"):
        after_scheme = uri.split("://", 1)[1]
        if "/" in after_scheme:
            host, path = after_scheme.split("/", 1)
            if path.startswith("?"):
                return f"{uri.split('://', 1)[0]}://{host}/{db_name}{path}"
            return uri
        return f"{uri}/{db_name}"
    return uri


MONGO_URL = ensure_db_in_uri(MONGO_URL, DB_NAME)

# Cliente singleton para reutilizar pool de conexiones
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]


# -------------------------
# HELPERS DE COLECCIONES
# -------------------------
def users_col():
    return db["users"]


def tx_col():
    return db["transactions"]


def accounts_col():
    return db["accounts"]


def budgets_col():
    return db["budgets"]


def goals_col():
    return db["goals"]


def categories_col():
    return db["categories"]


def cat_sections_col():
    return db["category_sections"]


def reminders_col():
    return db["reminders"]


def recurring_templates_col():
    return db["recurring_templates"]


def auto_rules_col():
    return db["auto_rules"]


# -------------------------
# CONFIGURACIÓN DE ÍNDICES
# -------------------------
async def create_indexes():
    """Crea índices para optimizar las consultas del backend."""
    try:
        await users_col().create_index("email", unique=True)
        await tx_col().create_index([("user_id", ASCENDING), ("date", DESCENDING)])
        await budgets_col().create_index([("user_id", ASCENDING), ("month", ASCENDING)])
        await accounts_col().create_index("user_id")
        await categories_col().create_index(
            [
                ("user_id", ASCENDING),
                ("section_id", ASCENDING),
                ("parent_id", ASCENDING),
            ]
        )
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

import os
import logging
from contextlib import asynccontextmanager
from typing import Annotated
from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .db import create_indexes
from .routes import router, BadRequestError
from .auth import get_current_user_id
from .logic import (
    seed_initial_categories,
    get_monthly_summary,
    get_accounts_balances,
    check_budgets_logic,
)

# Configurar logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

CurrentUserId = Annotated[str, Depends(get_current_user_id)]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    try:
        await create_indexes()
        logger.info("✅ Índices MongoDB creados/verificados")
    except Exception as e:
        logger.error("⚠️ No se pudieron crear índices: %s", e)

    # Seed opcional (solo inserta si faltan)
    try:
        await seed_initial_categories()
        logger.info("✅ Seed inicial comprobado")
    except Exception as e:
        logger.error("⚠️ No se pudo hacer seed inicial: %s", e)

    yield
    # Shutdown
    logger.info("App shutting down...")


app = FastAPI(
    title="Finance App API",
    description="API de gestión financiera personal",
    version="1.0.0",
    lifespan=lifespan,
)


def _format_validation_errors(errors):
    messages = []
    for err in errors or []:
        if not isinstance(err, dict):
            continue
        raw_loc = err.get("loc") or []
        loc_parts = [str(part) for part in raw_loc if str(part) != "body"]
        loc = ".".join(loc_parts)
        msg = str(err.get("msg") or "Dato inválido")
        messages.append(f"{loc}: {msg}" if loc else msg)
    return messages


# --- CORS MEJORADO ---
default_cors = (
    "http://localhost:3000,"
    "http://127.0.0.1:3000,"
    "http://localhost:4173,"
    "http://127.0.0.1:4173,"
    "http://localhost:5500,"
    "http://127.0.0.1:5500,"
    "null"
)
CORS_ORIGINS = [
    o.strip() for o in os.getenv("CORS_ORIGINS", default_cors).split(",") if o.strip()
]
CORS_ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX", r"https://.*\.vercel\.app")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    max_age=3600,
)


# --- MANEJO DE ERRORES GLOBAL ---
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    logger.warning(
        "HTTP %s: %s - Path: %s", exc.status_code, exc.detail, request.url.path
    )
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    details = _format_validation_errors(exc.errors())
    logger.error("Validation error on %s: %s", request.url.path, details)
    detail_text = " | ".join(details) if details else "Invalid request data"
    return JSONResponse(
        status_code=422,
        content={"detail": detail_text, "errors": details},
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.error("Unexpected error on %s: %s", request.url.path, exc, exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.exception_handler(BadRequestError)
async def bad_request_exception_handler(request: Request, exc: BadRequestError):
    logger.warning("Bad request on %s: %s", request.url.path, exc)
    return JSONResponse(status_code=400, content={"detail": str(exc)})


# --- MIDDLEWARE DE LOGGING ---
@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info("📍 %s %s", request.method, request.url.path)
    response = await call_next(request)
    logger.info("✓ Status %s", response.status_code)
    return response


# Registrar todas las rutas
app.include_router(router)


@app.get("/")
async def root():
    return {"ok": True, "docs": "/docs", "version": "1.0.0"}


# --- DASHBOARD & ANALYTICS ---
@app.get("/dashboard")
async def get_dashboard(user_id: CurrentUserId):
    """Consolida toda la información clave en una sola respuesta rápida."""
    logger.info("Dashboard load for user: %s", user_id)
    balances = await get_accounts_balances(user_id)
    net_worth = sum(acc["current_balance"] for acc in balances)
    monthly_summary = await get_monthly_summary(user_id)
    budgets_status = await check_budgets_logic(user_id)
    alert_budgets = [b for b in budgets_status if "🔴" in b["status"]]

    return {
        "net_worth": net_worth,
        "monthly_summary": monthly_summary,
        "accounts": balances,
        "budget_alerts": alert_budgets,
        "all_budgets": budgets_status,
    }


@app.get("/summary/monthly")
async def monthly_summary(user_id: CurrentUserId):
    """Resumen del ciclo actual (del día 26 al 25, con desglose por categoría)."""
    return await get_monthly_summary(user_id)


@app.get("/accounts/balances")
async def accounts_balances(user_id: CurrentUserId):
    """Saldos de todas las cuentas del usuario."""
    return await get_accounts_balances(user_id)

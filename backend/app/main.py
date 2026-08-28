# backend/app/main.py
import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .core.exceptions import AppException, BadRequestError
from .core.logging import setup_logging
from .core.security import get_current_user_id
from .db.database import close_db_connection, create_indexes
from .routes import router
from .services.finance import (
    check_budgets_logic,
    get_accounts_balances,
    get_monthly_summary,
    get_summary_for_period,
    parse_date_only,
    seed_initial_categories,
)

# Inicializar logging centralizado
setup_logging()
logger = logging.getLogger(__name__)

CurrentUserId = Annotated[str, Depends(get_current_user_id)]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Crear índices y seed inicial
    try:
        await create_indexes()
        logger.info("✅ Índices MongoDB verificados/creados")
    except Exception as e:
        logger.error("⚠️ Error verificando índices MongoDB: %s", e)

    try:
        await seed_initial_categories()
        logger.info("✅ Seed de categorías base verificado")
    except Exception as e:
        logger.error("⚠️ Error en seed base de categorías: %s", e)

    yield

    # Shutdown: Cerrar conexiones
    logger.info("Cerrando recursos de la aplicación...")
    await close_db_connection()
    logger.info("Aplicación detenida correctamente.")


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


# --- CONFIGURACIÓN DE CORS ---
default_cors = (
    "http://localhost:3000,"
    "http://127.0.0.1:3000,"
    "http://localhost:4173,"
    "http://127.0.0.1:4173,"
    "http://localhost:5173,"
    "http://127.0.0.1:5173,"
    "http://localhost:5500,"
    "http://127.0.0.1:5500"
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


# --- MANEJADORES GLOBALES DE EXCEPCIONES ---
@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    logger.warning(
        "AppException (%s) en %s: %s", exc.error_code, request.url.path, exc.message
    )
    return JSONResponse(status_code=exc.status_code, content=exc.to_dict())


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    logger.warning("HTTP %s en %s: %s", exc.status_code, request.url.path, exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": "HTTPException", "message": exc.detail},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    details = _format_validation_errors(exc.errors())
    logger.warning("Error de validación en %s: %s", request.url.path, details)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": "ValidationError",
            "message": "Datos de petición no válidos.",
            "details": details,
        },
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.exception("Error no controlado en %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "InternalServerError",
            "message": "Ha ocurrido un error interno.",
        },
    )


# --- MIDDLEWARE DE RENDIMIENTO Y LOGS ---
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - start_time) * 1000, 2)

    if request.url.path not in {"/docs", "/openapi.json", "/favicon.ico"}:
        logger.info(
            "%s %s -> %s (%sms)",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
    return response


# --- RUTAS DE ANALÍTICA Y DASHBOARD ---
@app.get("/")
async def root():
    return {"ok": True, "docs": "/docs", "version": "1.0.0"}


@app.get("/dashboard")
async def get_dashboard(user_id: CurrentUserId):
    """Consolida la información clave en una sola llamada paralela con asyncio.gather."""
    balances_task = get_accounts_balances(user_id)
    summary_task = get_monthly_summary(user_id)
    budgets_task = check_budgets_logic(user_id)

    balances, monthly_summary, budgets_status = await asyncio.gather(
        balances_task, summary_task, budgets_task
    )

    net_worth = round(sum(acc.get("current_balance", 0.0) for acc in balances), 2)
    alert_budgets = [b for b in budgets_status if "🔴" in b.get("status", "")]

    return {
        "net_worth": net_worth,
        "monthly_summary": monthly_summary,
        "accounts": balances,
        "budget_alerts": alert_budgets,
        "all_budgets": budgets_status,
    }


@app.get("/summary/monthly")
async def monthly_summary(
    user_id: CurrentUserId,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    """Resumen del ciclo actual o de un rango personalizado con desglose por categoría."""
    if bool(start_date) != bool(end_date):
        raise BadRequestError("Debes indicar start_date y end_date juntos.")

    if start_date and end_date:
        try:
            start = parse_date_only(start_date)
            end_inclusive = parse_date_only(end_date)
        except ValueError as exc:
            raise BadRequestError(str(exc)) from exc

        if end_inclusive < start:
            raise BadRequestError(
                "La fecha final no puede ser anterior a la fecha inicial."
            )

        return await get_summary_for_period(
            start, end_inclusive + timedelta(days=1), user_id
        )

    return await get_monthly_summary(user_id)


@app.get("/accounts/balances")
async def accounts_balances(user_id: CurrentUserId):
    """Saldos de todas las cuentas del usuario."""
    return await get_accounts_balances(user_id)


# Montar el router central de la app
app.include_router(router)

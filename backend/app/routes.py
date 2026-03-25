from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import Response
from bson import ObjectId
from datetime import datetime, UTC, timedelta
import calendar
import logging
import csv
import io
from typing import Optional, List, Any, Dict, Annotated
from pymongo.errors import DuplicateKeyError

# Importaciones locales (Rutas relativas para evitar errores)
from .db import (
    users_col,
    tx_col,
    budgets_col,
    cat_sections_col,
    categories_col,
    accounts_col,
    reminders_col,
    recurring_templates_col,
    auto_rules_col,
)
from .auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user_id,
    get_current_user_id_optional,
)
from .models import (
    UserCreate,
    ChangePasswordRequest,
    UserSettingsUpdate,
    TransactionCreate,
    TransferCreate,
    BudgetCreate,
    CategoryCreate,
    CategoryUpdate,
    AccountCreate,
    AccountUpdate,
    AccountReorder,
    ReminderCreate,
    ReminderUpdate,
    RecurringTemplateCreate,
    RecurringTemplateUpdate,
    AutoRuleCreate,
    AutoRuleUpdate,
    CsvImportRequest,
)
from .logic import (
    fix_id,
    get_accounts_balances,
    seed_initial_categories,
    seed_categories_for_user,
    get_billing_cycle_bounds,
    get_category_scope_query,
)
from .logic import seed_default_accounts_for_user, check_budgets_logic

router = APIRouter()
logger = logging.getLogger(__name__)

CurrentUserId = Annotated[str, Depends(get_current_user_id)]
OptionalCurrentUserId = Annotated[Optional[str], Depends(get_current_user_id_optional)]
LoginForm = Annotated[OAuth2PasswordRequestForm, Depends()]

ACCOUNT_NOT_FOUND_DETAIL = "Cuenta no encontrada"
TX_NOT_FOUND_DETAIL = "Transacción no encontrada"
REMINDER_NOT_FOUND_DETAIL = "Recordatorio no encontrado"
USER_NOT_FOUND_DETAIL = "Usuario no encontrado"
AUTOMATION_RULE_NOT_FOUND_DETAIL = "Regla no encontrada"
AUTOMATION_TEMPLATE_NOT_FOUND_DETAIL = "Plantilla recurrente no encontrada"

ResponseMap = Dict[int | str, Dict[str, Any]]

R400: ResponseMap = {400: {"description": "Solicitud inválida"}}
R401: ResponseMap = {401: {"description": "No autorizado"}}
R404: ResponseMap = {404: {"description": "Recurso no encontrado"}}
R409: ResponseMap = {409: {"description": "Conflicto"}}

DEFAULT_USER_SETTINGS = {
    "default_view": "home",
    "reduce_motion": False,
    "profile_avatar": "auto",
}


def normalize_user_settings(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    settings = dict(DEFAULT_USER_SETTINGS)
    if not isinstance(raw, dict):
        return settings

    default_view = str(raw.get("default_view") or "").strip()
    if default_view in {
        "home",
        "dashboard",
        "history",
        "stats",
        "accounts",
        "reminders",
    }:
        settings["default_view"] = default_view

    settings["reduce_motion"] = bool(raw.get("reduce_motion", False))

    avatar = str(raw.get("profile_avatar") or "").strip()
    if avatar in {"auto", "🙂", "😎", "🧠", "💼", "💸", "🚀"}:
        settings["profile_avatar"] = avatar

    return settings


class BadRequestError(ValueError):
    """Error de entrada inválida para mapear a respuesta HTTP 400."""

    pass


# -------------------------
# HELPERS
# -------------------------


def oid(id_: str) -> ObjectId:
    try:
        return ObjectId(id_)
    except Exception:
        raise BadRequestError("ID de base de datos inválido")


def month_range(month: str) -> tuple[datetime, datetime]:
    """Convierte 'YYYY-MM' en un rango de inicio y fin de mes"""
    try:
        start = datetime.fromisoformat(month + "-01T00:00:00")
        year, m = start.year, start.month
        end = datetime(year + 1, 1, 1) if m == 12 else datetime(year, m + 1, 1)
        return start, end
    except Exception:
        raise BadRequestError("Formato de mes inválido (usa YYYY-MM)")


def shift_reminder_due_date(base_due: datetime, recurrence: str) -> datetime:
    """Devuelve la siguiente fecha para recordatorios recurrentes."""
    if recurrence == "yearly":
        year = base_due.year + 1
        month = base_due.month
        day = min(base_due.day, calendar.monthrange(year, month)[1])
        return base_due.replace(year=year, month=month, day=day)

    if recurrence == "monthly":
        year = base_due.year
        month = base_due.month + 1
        if month > 12:
            month = 1
            year += 1
        day = min(base_due.day, calendar.monthrange(year, month)[1])
        return base_due.replace(year=year, month=month, day=day)

    return base_due


def normalize_reminder_update_doc(update_doc: Dict[str, Any]) -> Dict[str, Any]:
    if "title" in update_doc:
        cleaned_title = str(update_doc["title"] or "").strip()
        if not cleaned_title:
            raise HTTPException(status_code=400, detail="El título es obligatorio")
        update_doc["title"] = cleaned_title

    if "note" in update_doc and update_doc["note"] is not None:
        update_doc["note"] = str(update_doc["note"]).strip() or None

    return update_doc


def get_reminder_rollover_state(
    existing: Dict[str, Any],
    update_doc: Dict[str, Any],
) -> tuple[bool, str, bool]:
    recurrence = str(
        update_doc.get("recurrence") or existing.get("recurrence") or "none"
    )
    auto_advance = bool(
        update_doc.get("auto_advance")
        if "auto_advance" in update_doc
        else existing.get("auto_advance", True)
    )
    was_completed = bool(existing.get("is_completed"))
    now_completed = bool(update_doc.get("is_completed", was_completed))
    should_roll_forward = (
        not was_completed
        and now_completed
        and auto_advance
        and recurrence in {"monthly", "yearly"}
    )
    return should_roll_forward, recurrence, auto_advance


def build_next_reminder_doc(
    source_due: datetime,
    recurrence: str,
    auto_advance: bool,
    user_id: str,
    existing: Dict[str, Any],
    update_doc: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    next_due = shift_reminder_due_date(source_due, recurrence)
    if next_due == source_due:
        return None

    now = datetime.now(UTC)
    return {
        "user_id": user_id,
        "title": str(
            update_doc.get("title") or existing.get("title") or "Recordatorio"
        ).strip(),
        "due_date": next_due,
        "amount": update_doc.get("amount", existing.get("amount")),
        "type": update_doc.get("type", existing.get("type", "other")),
        "recurrence": recurrence,
        "auto_advance": auto_advance,
        "note": update_doc.get("note", existing.get("note")),
        "is_completed": False,
        "created_at": now,
        "updated_at": now,
    }


def normalize_dt(value: Any) -> Optional[datetime]:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    return value


def normalize_rule_text(value: Optional[str]) -> str:
    return str(value or "").strip().lower()


def safe_iso_datetime(value: Any) -> str:
    normalized = normalize_dt(value)
    return normalized.isoformat() if normalized else ""


def matches_rule(rule: Dict[str, Any], note: str) -> bool:
    keyword = normalize_rule_text(rule.get("keyword"))
    if not keyword:
        return False

    target = normalize_rule_text(note)
    mode = str(rule.get("match_mode") or "contains")

    if mode == "equals":
        return target == keyword
    if mode == "starts_with":
        return target.startswith(keyword)
    return keyword in target


def first_matching_rule(
    rules: List[Dict[str, Any]], note: str
) -> Optional[Dict[str, Any]]:
    for rule in rules:
        if matches_rule(rule, note):
            return rule
    return None


def apply_rule_mutations(
    payload: Dict[str, Any], rule: Dict[str, Any], note: str
) -> None:
    maybe_type = rule.get("type")
    if maybe_type:
        payload["type"] = maybe_type

    maybe_category = rule.get("category_id")
    if maybe_category:
        payload["category_id"] = str(maybe_category)

    if "subcategory_id" in rule:
        payload["subcategory_id"] = (
            str(rule.get("subcategory_id")) if rule.get("subcategory_id") else None
        )

    if "account_id" in rule:
        payload["account_id"] = (
            str(rule.get("account_id")) if rule.get("account_id") else None
        )

    prefix = str(rule.get("note_prefix") or "").strip()
    if prefix:
        payload["note"] = f"{prefix} {note}".strip()

    payload["applied_rule_id"] = str(rule.get("_id"))


def apply_auto_rule(
    payload: Dict[str, Any],
    rules: List[Dict[str, Any]],
) -> Dict[str, Any]:
    note = str(payload.get("note") or "").strip()
    if not note:
        return payload

    matched = first_matching_rule(rules, note)
    if matched:
        apply_rule_mutations(payload, matched, note)

    return payload


def calculate_yearly_due_dates(
    month_of_year: int,
    day_of_month: int,
    start_date: datetime,
    end_date: Optional[datetime],
    last_generated_on: Optional[datetime],
    until_dt: datetime,
) -> List[datetime]:
    due_dates: List[datetime] = []
    year = start_date.year
    while year <= until_dt.year + 1:
        last_day = calendar.monthrange(year, month_of_year)[1]
        due = datetime(year, month_of_year, min(day_of_month, last_day))
        if due < start_date:
            year += 1
            continue
        if end_date and due > end_date:
            break
        if due > until_dt:
            break
        if not last_generated_on or due > last_generated_on:
            due_dates.append(due)
        year += 1
    return due_dates


def advance_month_cursor(cursor: datetime) -> datetime:
    return (
        datetime(cursor.year + 1, 1, 1)
        if cursor.month == 12
        else datetime(cursor.year, cursor.month + 1, 1)
    )


def calculate_monthly_due_dates(
    day_of_month: int,
    start_date: datetime,
    end_date: Optional[datetime],
    last_generated_on: Optional[datetime],
    until_dt: datetime,
) -> List[datetime]:
    due_dates: List[datetime] = []
    cursor = datetime(start_date.year, start_date.month, 1)
    limit = 0
    while cursor <= until_dt and limit < 240:
        last_day = calendar.monthrange(cursor.year, cursor.month)[1]
        due = datetime(cursor.year, cursor.month, min(day_of_month, last_day))
        if due >= start_date and (not end_date or due <= end_date):
            if due <= until_dt and (not last_generated_on or due > last_generated_on):
                due_dates.append(due)
        elif end_date and due > end_date:
            break

        cursor = advance_month_cursor(cursor)
        limit += 1

    return due_dates


def calculate_due_dates_for_template(
    template: Dict[str, Any],
    until_dt: datetime,
) -> List[datetime]:
    cadence = str(template.get("cadence") or "monthly")
    day_of_month = int(template.get("day_of_month") or 1)
    start_date = normalize_dt(template.get("start_date")) or normalize_dt(
        template.get("created_at")
    )
    end_date = normalize_dt(template.get("end_date"))
    last_generated_on = normalize_dt(template.get("last_generated_on"))

    if not start_date:
        start_date = until_dt

    if end_date and end_date < start_date:
        return []

    if cadence == "yearly":
        month_of_year = int(template.get("month_of_year") or start_date.month)
        return calculate_yearly_due_dates(
            month_of_year,
            day_of_month,
            start_date,
            end_date,
            last_generated_on,
            until_dt,
        )

    return calculate_monthly_due_dates(
        day_of_month,
        start_date,
        end_date,
        last_generated_on,
        until_dt,
    )


def build_recurring_tx_doc(
    user_id: str, template: Dict[str, Any], due: datetime
) -> Dict[str, Any]:
    return {
        "user_id": str(user_id),
        "amount": float(template.get("amount") or 0),
        "type": str(template.get("type") or "expense"),
        "category_id": str(template.get("category_id") or ""),
        "subcategory_id": (
            str(template.get("subcategory_id"))
            if template.get("subcategory_id")
            else None
        ),
        "account_id": (
            str(template.get("account_id")) if template.get("account_id") else None
        ),
        "note": str(template.get("note") or template.get("name") or ""),
        "date": due,
        "recurring_template_id": str(template.get("_id")),
        "created_at": datetime.now(UTC),
    }


async def already_generated_for_day(
    user_id: str, template_id: str, due: datetime
) -> bool:
    day_start = datetime(due.year, due.month, due.day)
    day_end = day_start + timedelta(days=1)
    exists = await tx_col().find_one(
        {
            "user_id": str(user_id),
            "recurring_template_id": str(template_id),
            "date": {"$gte": day_start, "$lt": day_end},
        }
    )
    return bool(exists)


async def process_recurring_template(
    user_id: str,
    template: Dict[str, Any],
    until_dt: datetime,
) -> tuple[int, Optional[datetime]]:
    created = 0
    latest_generated = None
    due_dates = calculate_due_dates_for_template(template, until_dt)
    if not due_dates:
        return created, latest_generated

    for due in due_dates:
        if await already_generated_for_day(str(user_id), str(template.get("_id")), due):
            latest_generated = due
            continue

        tx_doc = build_recurring_tx_doc(str(user_id), template, due)
        if not tx_doc["category_id"]:
            continue

        await tx_col().insert_one(tx_doc)
        latest_generated = due
        created += 1

    return created, latest_generated


def build_raw_csv_row(csv_row: Any, has_header: bool) -> Dict[str, Any]:
    if has_header:
        return {
            "date": csv_row.get("date"),
            "type": csv_row.get("type"),
            "amount": csv_row.get("amount"),
            "category_id": csv_row.get("category_id"),
            "subcategory_id": csv_row.get("subcategory_id"),
            "account_id": csv_row.get("account_id"),
            "note": csv_row.get("note"),
        }

    values = list(csv_row)
    if len(values) < 7:
        raise ValueError("Fila incompleta")
    return {
        "date": values[0],
        "type": values[1],
        "amount": values[2],
        "category_id": values[3],
        "subcategory_id": values[4],
        "account_id": values[5],
        "note": values[6],
    }


def build_tx_doc_from_raw(raw: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    tx_type = str(raw.get("type") or "expense").strip().lower()
    if tx_type not in {"income", "expense"}:
        raise ValueError("type debe ser income o expense")

    amount = float(raw.get("amount") or 0)
    if amount <= 0:
        raise ValueError("amount debe ser mayor que 0")

    raw_date = str(raw.get("date") or "").strip()
    tx_date = (
        datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
        if raw_date
        else datetime.now()
    )

    return {
        "user_id": str(user_id),
        "type": tx_type,
        "amount": amount,
        "category_id": str(raw.get("category_id") or "").strip(),
        "subcategory_id": str(raw.get("subcategory_id") or "").strip() or None,
        "account_id": str(raw.get("account_id") or "").strip() or None,
        "note": str(raw.get("note") or "").strip() or None,
        "date": tx_date,
    }


async def import_csv_rows(
    user_id: str,
    reader: Any,
    has_header: bool,
    apply_rules_flag: bool,
    line_offset: int,
) -> Dict[str, Any]:
    imported = 0
    skipped = 0
    errors: List[str] = []
    rules: List[Dict[str, Any]] = []

    if apply_rules_flag:
        rules = (
            await auto_rules_col()
            .find({"user_id": str(user_id), "is_active": True})
            .sort("priority", 1)
            .to_list(300)
        )

    for idx, row in enumerate(reader, start=line_offset):
        try:
            raw = build_raw_csv_row(row, has_header)
            tx_doc = build_tx_doc_from_raw(raw, str(user_id))
            if apply_rules_flag:
                tx_doc = apply_auto_rule(tx_doc, rules)

            if not tx_doc.get("category_id"):
                skipped += 1
                errors.append(f"Línea {idx}: falta category_id y ninguna regla aplicó")
                continue

            await tx_col().insert_one(tx_doc)
            imported += 1
        except Exception as exc:
            skipped += 1
            errors.append(f"Línea {idx}: {exc}")

    return {
        "status": "success",
        "imported": imported,
        "skipped": skipped,
        "errors": errors[:20],
    }


async def collect_recurring_forecast_events(
    user_id: str,
    now: datetime,
    horizon: datetime,
    projected_delta_map: Dict[str, float],
) -> List[Dict[str, Any]]:
    def build_recurring_event(
        template: Dict[str, Any], due: datetime
    ) -> Dict[str, Any]:
        amount = float(template.get("amount") or 0)
        tx_type = str(template.get("type") or "expense")
        signed_amount = amount if tx_type == "income" else -amount
        account_id = str(template.get("account_id") or "")
        return {
            "date": due.isoformat(),
            "source": "recurring",
            "label": str(template.get("name") or "Recurrente"),
            "type": tx_type,
            "amount": round(signed_amount, 2),
            "account_id": account_id or None,
            "signed_amount": signed_amount,
            "raw_account_id": account_id,
        }

    templates = (
        await recurring_templates_col()
        .find({"user_id": str(user_id), "is_active": True})
        .to_list(500)
    )

    events: List[Dict[str, Any]] = []
    for template in templates:
        for due in calculate_due_dates_for_template(template, horizon):
            if due < now:
                continue
            event = build_recurring_event(template, due)
            account_id = str(event.pop("raw_account_id") or "")
            signed_amount = float(event.pop("signed_amount") or 0)
            if account_id:
                projected_delta_map[account_id] = (
                    projected_delta_map.get(account_id, 0.0) + signed_amount
                )
            events.append(event)
    return events


async def collect_reminder_forecast_events(
    user_id: str,
    now: datetime,
    horizon: datetime,
) -> List[Dict[str, Any]]:
    reminders = (
        await reminders_col()
        .find(
            {
                "user_id": str(user_id),
                "is_completed": False,
                "due_date": {"$gte": now, "$lte": horizon},
            }
        )
        .to_list(500)
    )

    events: List[Dict[str, Any]] = []
    for reminder in reminders:
        amount = float(reminder.get("amount") or 0)
        if amount <= 0:
            continue
        due = normalize_dt(reminder.get("due_date")) or now
        events.append(
            {
                "date": due.isoformat(),
                "source": "reminder",
                "label": str(reminder.get("title") or "Recordatorio"),
                "type": "expense",
                "amount": round(-amount, 2),
                "account_id": None,
            }
        )
    return events


def build_accounts_projection(
    name_map: Dict[str, str],
    balance_map: Dict[Any, float],
    projected_delta_map: Dict[str, float],
) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for account_id, account_name in name_map.items():
        current_balance = float(balance_map.get(account_id) or 0)
        delta = float(projected_delta_map.get(account_id) or 0)
        result.append(
            {
                "account_id": account_id,
                "account_name": account_name,
                "current_balance": round(current_balance, 2),
                "projected_delta": round(delta, 2),
                "projected_balance": round(current_balance + delta, 2),
            }
        )
    return result


async def generate_due_recurring_transactions(
    user_id: str,
    until: Optional[datetime] = None,
) -> int:
    until_dt = normalize_dt(until) or datetime.now()
    templates = (
        await recurring_templates_col()
        .find({"user_id": str(user_id), "is_active": True})
        .to_list(500)
    )
    created_count = 0

    for template in templates:
        created, latest_generated = await process_recurring_template(
            str(user_id), template, until_dt
        )
        created_count += created

        if latest_generated is not None:
            await recurring_templates_col().update_one(
                {"_id": template.get("_id"), "user_id": str(user_id)},
                {
                    "$set": {
                        "last_generated_on": latest_generated,
                        "updated_at": datetime.now(UTC),
                    }
                },
            )

    return created_count


# -------------------------
# AUTH (Registro y Login)
# -------------------------


@router.post("/auth/register", responses=R409)
async def register(payload: UserCreate):
    email = payload.email.lower().strip()
    existing = await users_col().find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Ese email ya está registrado")

    doc = {
        "email": email,
        "password": hash_password(payload.password),
        "settings": dict(DEFAULT_USER_SETTINGS),
    }
    try:
        res = await users_col().insert_one(doc)
        user_id = str(res.inserted_id)
        # El seed no debe romper el registro: solo dejamos warning en logs.
        try:
            await seed_default_accounts_for_user(user_id)
            await seed_categories_for_user(user_id)
        except Exception as exc:
            logger.warning("seed post-register failed for user %s: %s", user_id, exc)
        token = create_access_token(str(res.inserted_id))
        return {"access_token": token, "token_type": "bearer"}
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ese email ya existe")
    except ValueError as exc:
        # Errores de validación/hashing que no deben caer como 500 genérico.
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("register failed for email %s", email)
        raise HTTPException(
            status_code=500,
            detail=f"No se pudo crear el usuario: {str(exc)}",
        )


@router.post("/auth/login", responses=R401)
async def login(form: LoginForm):
    user = await users_col().find_one({"email": form.username.lower().strip()})
    if (not user) or (not verify_password(form.password, user["password"])):
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")

    # Seed idempotente por usuario al iniciar sesión (si aún no existían).
    # Nunca debe bloquear el login.
    try:
        await seed_default_accounts_for_user(str(user["_id"]))
        await seed_categories_for_user(str(user["_id"]))
    except Exception as exc:
        logger.warning("seed post-login failed for user %s: %s", user.get("_id"), exc)

    token = create_access_token(str(user["_id"]))
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", responses=R404)
async def get_me(user_id: CurrentUserId):
    user = await users_col().find_one({"_id": oid(user_id)}, {"password": 0})
    if not user:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND_DETAIL)
    return fix_id(user)


@router.get("/me/settings", responses=R404)
async def get_my_settings(user_id: CurrentUserId):
    user = await users_col().find_one({"_id": oid(user_id)}, {"settings": 1})
    if not user:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND_DETAIL)
    return normalize_user_settings(user.get("settings"))


@router.put("/me/settings", responses=R404 | R400)
async def update_my_settings(payload: UserSettingsUpdate, user_id: CurrentUserId):
    user = await users_col().find_one({"_id": oid(user_id)}, {"settings": 1})
    if not user:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND_DETAIL)

    incoming = payload.model_dump(exclude_unset=True)
    current = normalize_user_settings(user.get("settings"))

    merged = {
        **current,
        **incoming,
    }

    await users_col().update_one(
        {"_id": oid(user_id)},
        {"$set": {"settings": normalize_user_settings(merged)}},
    )

    return normalize_user_settings(merged)


@router.post(
    "/auth/change-password",
    responses={
        400: {"description": "Solicitud inválida"},
        404: {"description": "Recurso no encontrado"},
    },
)
async def change_password(payload: ChangePasswordRequest, user_id: CurrentUserId):
    user = await users_col().find_one({"_id": oid(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND_DETAIL)

    if not verify_password(payload.current_password, user["password"]):
        raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")

    if verify_password(payload.new_password, user["password"]):
        raise HTTPException(
            status_code=400,
            detail="La nueva contraseña debe ser diferente a la actual",
        )

    await users_col().update_one(
        {"_id": oid(user_id)},
        {"$set": {"password": hash_password(payload.new_password)}},
    )
    return {"status": "success", "message": "Contraseña actualizada"}


# ========================
# ACCOUNTS (CRUD)
# ========================


@router.post("/accounts")
async def create_account(payload: AccountCreate, user_id: CurrentUserId):
    """Crea una nueva cuenta para el usuario."""
    doc = payload.model_dump()
    doc["user_id"] = str(user_id)
    last_account = await accounts_col().find_one(
        {"user_id": str(user_id)}, sort=[("order", -1)]
    )
    last_order = int(last_account.get("order", -1)) if last_account else -1
    doc["order"] = last_order + 1
    res = await accounts_col().insert_one(doc)
    doc["_id"] = res.inserted_id
    return fix_id(doc)


@router.get("/accounts")
async def list_accounts(user_id: CurrentUserId):
    """Lista todas las cuentas del usuario."""
    # Asegura que existan las 4 cuentas por defecto incluso si el usuario
    # ya tenía un token guardado y no volvió a loguearse.
    await seed_default_accounts_for_user(str(user_id))

    cursor = accounts_col().find({"user_id": str(user_id)})
    accounts = await cursor.to_list(100)

    # Acompañar las cuentas con el balance calculado (ingresos - gastos),
    # para que la UI no muestre 0.00€.
    balances = await get_accounts_balances(user_id)
    balance_map = {
        b["account_id"]: b["current_balance"] for b in balances if b.get("account_id")
    }
    for a in accounts:
        acc_id = str(a["_id"])
        a["current_balance"] = balance_map.get(acc_id, 0)
    accounts.sort(
        key=lambda a: (
            0 if isinstance(a.get("order"), int) else 1,
            int(a.get("order", 10**9)),
            str(a.get("name", "")).lower(),
        )
    )

    return [fix_id(a) for a in accounts]


@router.post("/accounts/reorder", responses=R400)
async def reorder_accounts(payload: AccountReorder, user_id: CurrentUserId):
    """Guarda el orden manual de las cuentas del usuario."""
    provided_ids = [acc_id for acc_id in payload.account_ids if acc_id]
    if not provided_ids:
        raise HTTPException(status_code=400, detail="Debes indicar cuentas")

    user_accounts = await accounts_col().find({"user_id": str(user_id)}).to_list(300)
    valid_ids = {str(account.get("_id")) for account in user_accounts}

    has_duplicates = len(set(provided_ids)) != len(provided_ids)
    if (
        has_duplicates
        or len(provided_ids) != len(valid_ids)
        or set(provided_ids) != valid_ids
    ):
        raise HTTPException(
            status_code=400,
            detail="El orden debe incluir todas tus cuentas exactamente una vez",
        )

    for index, account_id in enumerate(provided_ids):
        await accounts_col().update_one(
            {"_id": oid(account_id), "user_id": str(user_id)},
            {"$set": {"order": index}},
        )

    return {"status": "success", "message": "Orden actualizado"}


@router.get("/accounts/{account_id}", responses=R404)
async def get_account(account_id: str, user_id: CurrentUserId):
    """Obtiene una cuenta específica."""
    account = await accounts_col().find_one(
        {"_id": oid(account_id), "user_id": str(user_id)}
    )
    if not account:
        raise HTTPException(status_code=404, detail=ACCOUNT_NOT_FOUND_DETAIL)

    # Balance calculado en base a transacciones (ingresos - gastos).
    acc_id_str = str(account["_id"])
    txs = (
        await tx_col()
        .find({"user_id": str(user_id), "account_id": acc_id_str})
        .to_list(1000)
    )

    total_acc = account.get("balance_inicial", 0)
    for t in txs:
        if t.get("type") == "income":
            total_acc += t.get("amount", 0)
        else:
            total_acc -= t.get("amount", 0)

    account["current_balance"] = round(total_acc, 2)
    return fix_id(account)


@router.patch("/accounts/{account_id}", responses=R404)
async def update_account(
    account_id: str,
    payload: AccountUpdate,
    user_id: CurrentUserId,
):
    """Actualiza una cuenta existente del usuario."""
    account = await accounts_col().find_one(
        {"_id": oid(account_id), "user_id": str(user_id)}
    )
    if not account:
        raise HTTPException(status_code=404, detail=ACCOUNT_NOT_FOUND_DETAIL)

    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return fix_id(account)

    await accounts_col().update_one(
        {"_id": oid(account_id), "user_id": str(user_id)},
        {"$set": update_data},
    )

    updated = await accounts_col().find_one(
        {"_id": oid(account_id), "user_id": str(user_id)}
    )
    return fix_id(updated)


@router.delete(
    "/accounts/{account_id}",
    responses={
        404: {"description": "Recurso no encontrado"},
        409: {"description": "Conflicto"},
    },
)
async def delete_account(account_id: str, user_id: CurrentUserId):
    """Elimina una cuenta (si no tiene transacciones)."""
    # Verificar que la cuenta existe y pertenece al usuario
    account = await accounts_col().find_one(
        {"_id": oid(account_id), "user_id": str(user_id)}
    )
    if not account:
        raise HTTPException(status_code=404, detail=ACCOUNT_NOT_FOUND_DETAIL)

    # Verificar que no tiene transacciones
    tx_count = await tx_col().count_documents(
        {"account_id": account_id, "user_id": str(user_id)}
    )
    if tx_count > 0:
        raise HTTPException(
            status_code=409, detail="No puedes eliminar una cuenta con transacciones"
        )

    await accounts_col().delete_one({"_id": oid(account_id)})
    return {"status": "success", "message": "Cuenta eliminada"}


@router.post("/accounts/{account_id}/reset", responses=R404)
async def reset_account(account_id: str, user_id: CurrentUserId):
    """Reinicia una cuenta concreta: saldo inicial a 0 y borra sus movimientos."""
    account = await accounts_col().find_one(
        {"_id": oid(account_id), "user_id": str(user_id)}
    )
    if not account:
        raise HTTPException(status_code=404, detail=ACCOUNT_NOT_FOUND_DETAIL)

    delete_result = await tx_col().delete_many(
        {"account_id": account_id, "user_id": str(user_id)}
    )

    await accounts_col().update_one(
        {"_id": oid(account_id), "user_id": str(user_id)},
        {"$set": {"balance_inicial": 0}},
    )

    return {
        "status": "success",
        "message": "Cuenta reiniciada",
        "deleted_transactions": delete_result.deleted_count,
    }


# ========================
# TRANSACTIONS
# ========================


@router.post("/transactions")
async def create_transaction(tx: TransactionCreate, user_id: CurrentUserId):
    new_tx = tx.model_dump()
    new_tx["user_id"] = str(user_id)
    result = await tx_col().insert_one(new_tx)
    new_tx["_id"] = result.inserted_id
    return fix_id(new_tx)


@router.post(
    "/transfers",
    responses={
        400: {"description": "Solicitud inválida"},
        404: {"description": "Recurso no encontrado"},
    },
)
async def create_transfer(payload: TransferCreate, user_id: CurrentUserId):
    """Crea un traspaso entre dos cuentas del usuario sin afectar al resumen mensual."""
    if payload.source_account_id == payload.destination_account_id:
        raise HTTPException(
            status_code=400,
            detail="La cuenta de origen y destino deben ser distintas",
        )

    source = await accounts_col().find_one(
        {"_id": oid(payload.source_account_id), "user_id": str(user_id)}
    )
    destination = await accounts_col().find_one(
        {"_id": oid(payload.destination_account_id), "user_id": str(user_id)}
    )

    if not source or not destination:
        raise HTTPException(status_code=404, detail=ACCOUNT_NOT_FOUND_DETAIL)

    now = payload.date or datetime.now()
    base_note = (payload.description or "Transferencia entre cuentas").strip()

    outgoing = {
        "user_id": str(user_id),
        "amount": payload.amount,
        "type": "expense",
        "category_id": "transfer_out",
        "subcategory_id": None,
        "account_id": payload.source_account_id,
        "note": f"{base_note}: a {destination.get('name', 'destino')}",
        "date": now,
    }
    incoming = {
        "user_id": str(user_id),
        "amount": payload.amount,
        "type": "income",
        "category_id": "transfer_in",
        "subcategory_id": None,
        "account_id": payload.destination_account_id,
        "note": f"{base_note}: desde {source.get('name', 'origen')}",
        "date": now,
    }

    out_result = await tx_col().insert_one(outgoing)
    in_result = await tx_col().insert_one(incoming)
    outgoing["_id"] = out_result.inserted_id
    incoming["_id"] = in_result.inserted_id

    return {
        "status": "success",
        "message": "Transferencia registrada",
        "outgoing": fix_id(outgoing),
        "incoming": fix_id(incoming),
    }


@router.get("/transactions")
async def list_transactions(
    user_id: CurrentUserId,
    limit: int = 50,
    month: Optional[str] = None,
    cycle: Optional[str] = None,
):
    """Lista transacciones. Permite filtrar por mes natural o por ciclo activo."""
    await generate_due_recurring_transactions(str(user_id))
    query: Dict[str, Any] = {"user_id": str(user_id)}

    if cycle == "current":
        start, end = get_billing_cycle_bounds()
        query["date"] = {"$gte": start, "$lt": end}
    elif month:
        start, end = month_range(month)
        query["date"] = {"$gte": start, "$lt": end}

    cursor = tx_col().find(query).sort("date", -1).limit(limit)
    transactions = await cursor.to_list(length=limit)
    return [fix_id(t) for t in transactions]


@router.get("/transactions/export.csv")
async def export_transactions_csv(user_id: CurrentUserId):
    rows = await tx_col().find({"user_id": str(user_id)}).sort("date", -1).to_list(5000)

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "date",
            "type",
            "amount",
            "category_id",
            "subcategory_id",
            "account_id",
            "note",
        ]
    )

    for row in rows:
        date_text = safe_iso_datetime(row.get("date"))
        writer.writerow(
            [
                date_text,
                row.get("type", "expense"),
                row.get("amount", 0),
                row.get("category_id", ""),
                row.get("subcategory_id", ""),
                row.get("account_id", ""),
                row.get("note", ""),
            ]
        )

    content = buffer.getvalue()
    buffer.close()

    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="movimientos.csv"',
        },
    )


@router.post("/transactions/import-csv", responses=R400)
async def import_transactions_csv(payload: CsvImportRequest, user_id: CurrentUserId):
    text = str(payload.csv_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="CSV vacío")

    reader: Any
    stream = io.StringIO(text)

    if payload.has_header:
        reader = csv.DictReader(stream, delimiter=payload.delimiter)
    else:
        reader = csv.reader(stream, delimiter=payload.delimiter)

    line_offset = 2 if payload.has_header else 1
    return await import_csv_rows(
        str(user_id),
        reader,
        payload.has_header,
        payload.apply_rules,
        line_offset,
    )


# -------------------------
# AUTOMATIZACIONES
# -------------------------


@router.get("/automation/recurring")
async def list_recurring_templates(user_id: CurrentUserId):
    items = (
        await recurring_templates_col()
        .find({"user_id": str(user_id)})
        .sort([("is_active", -1), ("name", 1)])
        .to_list(500)
    )
    return [fix_id(item) for item in items]


@router.post("/automation/recurring")
async def create_recurring_template(
    payload: RecurringTemplateCreate,
    user_id: CurrentUserId,
):
    doc = payload.model_dump()
    now = datetime.now(UTC)
    doc["user_id"] = str(user_id)
    doc["created_at"] = now
    doc["updated_at"] = now
    doc["name"] = str(doc.get("name") or "").strip()
    doc["note"] = str(doc.get("note") or "").strip() or None
    if doc.get("cadence") == "yearly" and not doc.get("month_of_year"):
        start = (
            normalize_dt(doc.get("start_date")) or normalize_dt(now) or datetime.now()
        )
        doc["month_of_year"] = int(start.month)

    res = await recurring_templates_col().insert_one(doc)
    doc["_id"] = res.inserted_id
    return fix_id(doc)


@router.patch("/automation/recurring/{template_id}", responses=R404)
async def update_recurring_template(
    template_id: str,
    payload: RecurringTemplateUpdate,
    user_id: CurrentUserId,
):
    existing = await recurring_templates_col().find_one(
        {"_id": oid(template_id), "user_id": str(user_id)}
    )
    if not existing:
        raise HTTPException(
            status_code=404, detail=AUTOMATION_TEMPLATE_NOT_FOUND_DETAIL
        )

    update_doc = payload.model_dump(exclude_unset=True)
    if "name" in update_doc:
        update_doc["name"] = str(update_doc["name"] or "").strip()
    if "note" in update_doc:
        update_doc["note"] = str(update_doc["note"] or "").strip() or None

    if not update_doc:
        return fix_id(existing)

    update_doc["updated_at"] = datetime.now(UTC)
    await recurring_templates_col().update_one(
        {"_id": oid(template_id), "user_id": str(user_id)},
        {"$set": update_doc},
    )
    updated = await recurring_templates_col().find_one(
        {"_id": oid(template_id), "user_id": str(user_id)}
    )
    return fix_id(updated)


@router.delete("/automation/recurring/{template_id}", responses=R404)
async def delete_recurring_template(template_id: str, user_id: CurrentUserId):
    result = await recurring_templates_col().delete_one(
        {"_id": oid(template_id), "user_id": str(user_id)}
    )
    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404, detail=AUTOMATION_TEMPLATE_NOT_FOUND_DETAIL
        )
    return {"status": "success", "message": "Plantilla eliminada"}


@router.get("/automation/rules")
async def list_automation_rules(user_id: CurrentUserId):
    items = (
        await auto_rules_col()
        .find({"user_id": str(user_id)})
        .sort([("priority", 1), ("name", 1)])
        .to_list(500)
    )
    return [fix_id(item) for item in items]


@router.post("/automation/rules")
async def create_automation_rule(payload: AutoRuleCreate, user_id: CurrentUserId):
    doc = payload.model_dump()
    now = datetime.now(UTC)
    doc["user_id"] = str(user_id)
    doc["created_at"] = now
    doc["updated_at"] = now
    doc["name"] = str(doc.get("name") or "").strip()
    doc["keyword"] = str(doc.get("keyword") or "").strip()
    doc["note_prefix"] = str(doc.get("note_prefix") or "").strip() or None

    res = await auto_rules_col().insert_one(doc)
    doc["_id"] = res.inserted_id
    return fix_id(doc)


@router.patch("/automation/rules/{rule_id}", responses=R404)
async def update_automation_rule(
    rule_id: str,
    payload: AutoRuleUpdate,
    user_id: CurrentUserId,
):
    existing = await auto_rules_col().find_one(
        {"_id": oid(rule_id), "user_id": str(user_id)}
    )
    if not existing:
        raise HTTPException(status_code=404, detail=AUTOMATION_RULE_NOT_FOUND_DETAIL)

    update_doc = payload.model_dump(exclude_unset=True)
    if "name" in update_doc:
        update_doc["name"] = str(update_doc["name"] or "").strip()
    if "keyword" in update_doc:
        update_doc["keyword"] = str(update_doc["keyword"] or "").strip()
    if "note_prefix" in update_doc:
        update_doc["note_prefix"] = str(update_doc["note_prefix"] or "").strip() or None

    if not update_doc:
        return fix_id(existing)

    update_doc["updated_at"] = datetime.now(UTC)
    await auto_rules_col().update_one(
        {"_id": oid(rule_id), "user_id": str(user_id)},
        {"$set": update_doc},
    )
    updated = await auto_rules_col().find_one(
        {"_id": oid(rule_id), "user_id": str(user_id)}
    )
    return fix_id(updated)


@router.delete("/automation/rules/{rule_id}", responses=R404)
async def delete_automation_rule(rule_id: str, user_id: CurrentUserId):
    result = await auto_rules_col().delete_one(
        {"_id": oid(rule_id), "user_id": str(user_id)}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=AUTOMATION_RULE_NOT_FOUND_DETAIL)
    return {"status": "success", "message": "Regla eliminada"}


@router.post("/automation/run")
async def run_automations(user_id: CurrentUserId):
    generated = await generate_due_recurring_transactions(str(user_id))
    return {"status": "success", "generated": generated}


@router.get("/forecast")
async def get_forecast(user_id: CurrentUserId, days: int = 30):
    forecast_days = max(1, min(int(days), 365))
    now = datetime.now()
    horizon = now + timedelta(days=forecast_days)

    await generate_due_recurring_transactions(str(user_id), until=now)

    accounts = await accounts_col().find({"user_id": str(user_id)}).to_list(300)
    balances = await get_accounts_balances(str(user_id))
    balance_map = {
        item.get("account_id"): float(item.get("current_balance") or 0)
        for item in balances
    }
    name_map = {
        str(acc.get("_id")): str(acc.get("name") or "Cuenta") for acc in accounts
    }

    projected_delta_map: Dict[str, float] = dict.fromkeys(name_map.keys(), 0.0)
    recurring_events = await collect_recurring_forecast_events(
        str(user_id),
        now,
        horizon,
        projected_delta_map,
    )
    reminder_events = await collect_reminder_forecast_events(
        str(user_id),
        now,
        horizon,
    )

    events = [*recurring_events, *reminder_events]

    events.sort(key=lambda item: item.get("date") or "")

    accounts_projection = build_accounts_projection(
        name_map,
        balance_map,
        projected_delta_map,
    )

    global_current = sum(item["current_balance"] for item in accounts_projection)
    global_projected = sum(item["projected_balance"] for item in accounts_projection)

    return {
        "days": forecast_days,
        "from": now.isoformat(),
        "to": horizon.isoformat(),
        "global_current_balance": round(global_current, 2),
        "global_projected_balance": round(global_projected, 2),
        "accounts": accounts_projection,
        "events": events[:200],
    }


@router.get("/transactions/{tx_id}", responses=R404)
async def get_transaction(tx_id: str, user_id: CurrentUserId):
    tx = await tx_col().find_one({"_id": oid(tx_id), "user_id": str(user_id)})
    if not tx:
        raise HTTPException(status_code=404, detail=TX_NOT_FOUND_DETAIL)
    return fix_id(tx)


@router.patch(
    "/transactions/{tx_id}",
    responses={
        400: {"description": "Solicitud inválida"},
        404: {"description": "Recurso no encontrado"},
    },
)
async def update_transaction(
    tx_id: str, payload: Dict[str, Any], user_id: CurrentUserId
):
    # Allow only specific fields to be updated
    allowed = {
        "amount",
        "type",
        "category_id",
        "subcategory_id",
        "note",
        "account_id",
        "date",
    }
    update = {k: v for k, v in payload.items() if k in allowed}
    if not update:
        raise HTTPException(
            status_code=400, detail="No hay campos válidos para actualizar"
        )

    result = await tx_col().update_one(
        {"_id": oid(tx_id), "user_id": str(user_id)}, {"$set": update}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=TX_NOT_FOUND_DETAIL)

    tx = await tx_col().find_one({"_id": oid(tx_id), "user_id": str(user_id)})
    return fix_id(tx)


@router.delete("/transactions/{tx_id}", responses=R404)
async def delete_transaction(tx_id: str, user_id: CurrentUserId):
    result = await tx_col().delete_one({"_id": oid(tx_id), "user_id": str(user_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=TX_NOT_FOUND_DETAIL)
    return {"status": "success", "message": "Movimiento eliminado"}


# -------------------------
# BUDGETS
# -------------------------


@router.post("/budgets")
async def set_budget(budget: BudgetCreate, user_id: CurrentUserId):
    query = {
        "user_id": str(user_id),
        "category_id": budget.category_id,
        "month": budget.month,
        "year": budget.year,
    }
    update = {"$set": budget.model_dump()}
    await budgets_col().update_one(query, update, upsert=True)
    return {"status": "success", "message": "Presupuesto guardado"}


@router.get("/budgets")
async def list_budgets(
    user_id: CurrentUserId,
    month: Optional[int] = None,
    year: Optional[int] = None,
):
    if month is None or year is None:
        start, _ = get_billing_cycle_bounds()
        month = month or start.month
        year = year or start.year

    query = {"user_id": str(user_id), "month": month, "year": year}
    budgets = await budgets_col().find(query).to_list(200)
    return [fix_id(b) for b in budgets]


@router.delete("/budgets/{budget_id}", responses=R404)
async def delete_budget(budget_id: str, user_id: CurrentUserId):
    result = await budgets_col().delete_one(
        {"_id": oid(budget_id), "user_id": str(user_id)}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")
    return {"status": "success", "message": "Presupuesto eliminado"}


@router.get("/budgets/check")
async def check_budgets(user_id: CurrentUserId):
    return await check_budgets_logic(user_id)


# -------------------------
# REMINDERS
# -------------------------


@router.post("/reminders")
async def create_reminder(payload: ReminderCreate, user_id: CurrentUserId):
    doc = payload.model_dump()
    doc["title"] = doc["title"].strip()
    if doc.get("note") is not None:
        doc["note"] = str(doc["note"]).strip() or None
    now = datetime.now(UTC)
    doc["user_id"] = str(user_id)
    doc["created_at"] = now
    doc["updated_at"] = now

    result = await reminders_col().insert_one(doc)
    doc["_id"] = result.inserted_id
    return fix_id(doc)


@router.get("/reminders")
async def list_reminders(
    user_id: CurrentUserId,
    include_completed: bool = True,
):
    query: Dict[str, Any] = {"user_id": str(user_id)}
    if not include_completed:
        query["is_completed"] = False

    reminders = (
        await reminders_col()
        .find(query)
        .sort([("is_completed", 1), ("due_date", 1), ("created_at", -1)])
        .to_list(500)
    )
    return [fix_id(item) for item in reminders]


@router.patch(
    "/reminders/{reminder_id}",
    responses={
        400: {"description": "Solicitud inválida"},
        404: {"description": "Recurso no encontrado"},
    },
)
async def update_reminder(
    reminder_id: str,
    payload: ReminderUpdate,
    user_id: CurrentUserId,
):
    existing = await reminders_col().find_one(
        {"_id": oid(reminder_id), "user_id": str(user_id)}
    )
    if not existing:
        raise HTTPException(status_code=404, detail=REMINDER_NOT_FOUND_DETAIL)

    update_doc = normalize_reminder_update_doc(payload.model_dump(exclude_unset=True))

    if not update_doc:
        return fix_id(existing)

    should_roll_forward, recurrence, auto_advance = get_reminder_rollover_state(
        existing,
        update_doc,
    )

    update_doc["updated_at"] = datetime.now(UTC)
    await reminders_col().update_one(
        {"_id": oid(reminder_id), "user_id": str(user_id)},
        {"$set": update_doc},
    )

    if should_roll_forward:
        source_due = update_doc.get("due_date") or existing.get("due_date")
        if isinstance(source_due, datetime):
            next_doc = build_next_reminder_doc(
                source_due,
                recurrence,
                auto_advance,
                str(user_id),
                existing,
                update_doc,
            )
            if next_doc:
                await reminders_col().insert_one(next_doc)

    updated = await reminders_col().find_one(
        {"_id": oid(reminder_id), "user_id": str(user_id)}
    )
    return fix_id(updated)


@router.delete("/reminders/{reminder_id}", responses=R404)
async def delete_reminder(reminder_id: str, user_id: CurrentUserId):
    result = await reminders_col().delete_one(
        {"_id": oid(reminder_id), "user_id": str(user_id)}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=REMINDER_NOT_FOUND_DETAIL)
    return {"status": "success", "message": "Recordatorio eliminado"}


# -------------------------
# CATEGORIES & SECTIONS
# -------------------------


@router.get("/categories/tree")
async def get_category_tree(
    user_id: OptionalCurrentUserId,
):
    if user_id:
        await seed_categories_for_user(str(user_id))

    sections_raw = await cat_sections_col().find({}).to_list(100)
    all_cats_raw = (
        await categories_col().find(get_category_scope_query(user_id)).to_list(1000)
    )

    # Convertimos a lista de diccionarios limpios
    all_cats: List[Dict[str, Any]] = []
    for c in all_cats_raw:
        item = fix_id(c)
        if isinstance(item, dict):
            all_cats.append(item)

    def category_sort_key(item: Dict[str, Any]) -> tuple[Any, ...]:
        raw_order = item.get("order")
        if raw_order is None:
            return (1, 10**9, str(item.get("name", "")).lower())
        try:
            normalized_order = int(raw_order)
            return (0, normalized_order, str(item.get("name", "")).lower())
        except (TypeError, ValueError):
            return (1, 10**9, str(item.get("name", "")).lower())

    result = []
    for sec in sections_raw:
        sec_id = str(sec["_id"])

        # Filtramos categorías padre de esta sección
        main_categories = [
            c
            for c in all_cats
            if str(c.get("section_id")) == sec_id and not c.get("parent_id")
        ]

        main_categories.sort(key=category_sort_key)

        # Construimos la jerarquía para cada padre
        for p_cat in main_categories:
            p_id = p_cat.get("id")
            # Buscamos subcategorías cuyo parent_id coincida con el id del padre
            matching_subs = [
                s for s in all_cats if str(s.get("parent_id")) == str(p_id)
            ]
            matching_subs.sort(key=category_sort_key)
            p_cat["subcategories"] = matching_subs

        result.append(
            {
                "section": sec.get("name"),
                "section_id": sec_id,
                "categories": main_categories,
            }
        )
    return result


@router.post("/categories", responses=R404)
async def create_category(payload: CategoryCreate, user_id: CurrentUserId):
    await seed_categories_for_user(str(user_id))
    doc = payload.model_dump()
    doc["user_id"] = str(user_id)

    if doc.get("parent_id"):
        parent = await categories_col().find_one(
            {"_id": oid(doc["parent_id"]), **get_category_scope_query(user_id)}
        )
        if not parent:
            raise HTTPException(status_code=404, detail="Categoría padre no encontrada")
        doc["section_id"] = str(parent.get("section_id"))

    res = await categories_col().insert_one(doc)
    doc["_id"] = res.inserted_id
    return fix_id(doc)


@router.patch(
    "/categories/{category_id}",
    responses={
        400: {"description": "Solicitud inválida"},
        404: {"description": "Recurso no encontrado"},
    },
)
async def update_category(
    category_id: str,
    payload: CategoryUpdate,
    user_id: CurrentUserId,
):
    await seed_categories_for_user(str(user_id))
    existing = await categories_col().find_one(
        {"_id": oid(category_id), **get_category_scope_query(user_id)}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")

    update_doc = payload.model_dump(exclude_unset=True)
    if not update_doc:
        return fix_id(existing)

    if update_doc.get("parent_id"):
        if str(update_doc["parent_id"]) == str(category_id):
            raise HTTPException(
                status_code=400, detail="Una categoría no puede ser su propio padre"
            )

        parent = await categories_col().find_one(
            {"_id": oid(update_doc["parent_id"]), **get_category_scope_query(user_id)}
        )
        if not parent:
            raise HTTPException(status_code=404, detail="Categoría padre no encontrada")
        update_doc["section_id"] = str(parent.get("section_id"))

    await categories_col().update_one(
        {"_id": oid(category_id), **get_category_scope_query(user_id)},
        {"$set": update_doc},
    )
    updated = await categories_col().find_one(
        {"_id": oid(category_id), **get_category_scope_query(user_id)}
    )
    return fix_id(updated)


@router.delete(
    "/categories/{category_id}",
    responses={
        404: {"description": "Recurso no encontrado"},
        409: {"description": "Conflicto"},
    },
)
async def delete_category(
    category_id: str,
    user_id: CurrentUserId,
):
    await seed_categories_for_user(str(user_id))
    category = await categories_col().find_one(
        {"_id": oid(category_id), **get_category_scope_query(user_id)}
    )
    if not category:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")

    child_categories = (
        await categories_col()
        .find({"parent_id": str(category_id), **get_category_scope_query(user_id)})
        .to_list(200)
    )
    child_ids = [str(item["_id"]) for item in child_categories]

    category_tx_count = await tx_col().count_documents(
        {"category_id": str(category_id), "user_id": str(user_id)}
    )
    subcategory_tx_count = 0
    if child_ids:
        subcategory_tx_count = await tx_col().count_documents(
            {"subcategory_id": {"$in": child_ids}, "user_id": str(user_id)}
        )

    own_subcategory_tx_count = await tx_col().count_documents(
        {"subcategory_id": str(category_id), "user_id": str(user_id)}
    )

    if (
        category_tx_count > 0
        or subcategory_tx_count > 0
        or own_subcategory_tx_count > 0
    ):
        raise HTTPException(
            status_code=409,
            detail="No puedes eliminar una categoría o subcategoría con movimientos asociados",
        )

    if child_ids:
        await categories_col().delete_many(
            {"parent_id": str(category_id), **get_category_scope_query(user_id)}
        )

    await categories_col().delete_one(
        {"_id": oid(category_id), **get_category_scope_query(user_id)}
    )
    return {"status": "success", "message": "Categoría eliminada"}


# Debug endpoints removed. Use the protected `POST /admin/seed-defaults`
# to reseed categories if necessary. Debug endpoints were removed for
# production safety.


# ----
# ADMIN ROUTES
# ----
@router.post("/admin/seed-defaults")
async def seed_defaults(user_id: CurrentUserId):
    """Borra todas las categorías/secciones globales y las recrea desde cero.

    Útil para aplicar nuevas listas de categorías. Solo modifica colecciones
    globales (sin user_id), no afecta transacciones ni cuentas del usuario.
    """
    from .db import categories_col, cat_sections_col

    await categories_col().delete_many({})
    await cat_sections_col().delete_many({})
    await seed_initial_categories()
    return {"status": "ok", "message": "Categorías recreadas correctamente"}


@router.post("/admin/reset-user-data")
async def reset_user_data(user_id: CurrentUserId):
    """Borra TODOS los datos del usuario (transacciones + cuentas) e reinicia
    las 4 cuentas por defecto con saldo 0.

    ⚠️ CUIDADO: Esta operación es irreversible.
    """
    # Eliminar todas las transacciones del usuario
    await tx_col().delete_many({"user_id": str(user_id)})

    # Eliminar todas las cuentas del usuario
    await accounts_col().delete_many({"user_id": str(user_id)})

    # Eliminar todos los presupuestos del usuario
    await budgets_col().delete_many({"user_id": str(user_id)})

    # Reiniciar las 4 cuentas por defecto
    await seed_default_accounts_for_user(str(user_id))

    return {"status": "ok", "message": "Datos del usuario eliminados y reinicializados"}

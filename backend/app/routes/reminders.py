# backend/app/routers/reminders.py
import calendar
from datetime import datetime, timezone
from typing import Annotated, Any, Dict, Optional
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, status

from ..core.security import get_current_user_id
from ..db.database import reminders_col
from ..schemas.schemas import ReminderCreate, ReminderUpdate
from ..services.finance import fix_id
from ..utils.helpers import normalize_dt, oid

router = APIRouter(prefix="/reminders", tags=["Reminders"])
CurrentUserId = Annotated[str, Depends(get_current_user_id)]


def _safe_oid(val: str) -> Any:
    """Convierte a ObjectId o levanta 404 si el formato es inválido."""
    try:
        return oid(val)
    except (InvalidId, ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Identificador de recordatorio inválido.",
        )


def _to_utc_datetime(dt: Optional[datetime]) -> datetime:
    """Asegura formato datetime aware en UTC."""
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def shift_reminder_due_date(base_due: datetime, recurrence: str) -> datetime:
    """Calcula la siguiente fecha de vencimiento ajustando el fin de mes."""
    base_due = _to_utc_datetime(base_due)
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


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_reminder(payload: ReminderCreate, user_id: CurrentUserId):
    doc = payload.model_dump()
    doc["title"] = doc["title"].strip()
    if not doc["title"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El título no puede estar vacío.",
        )

    if doc.get("note") is not None:
        doc["note"] = str(doc["note"]).strip() or None

    now = datetime.now(timezone.utc)
    doc["user_id"] = str(user_id)
    doc["due_date"] = _to_utc_datetime(normalize_dt(doc.get("due_date")))
    doc["created_at"] = now
    doc["updated_at"] = now

    result = await reminders_col().insert_one(doc)
    doc["_id"] = result.inserted_id
    return fix_id(doc)


@router.get("")
async def list_reminders(user_id: CurrentUserId, include_completed: bool = True):
    query: Dict[str, Any] = {"user_id": str(user_id)}
    if not include_completed:
        query["is_completed"] = False

    reminders = (
        await reminders_col()
        .find(query)
        .sort([("is_completed", 1), ("due_date", 1), ("created_at", -1)])
        .to_list(length=500)
    )
    return [fix_id(item) for item in reminders]


@router.patch("/{reminder_id}")
async def update_reminder(
    reminder_id: str, payload: ReminderUpdate, user_id: CurrentUserId
):
    target_oid = _safe_oid(reminder_id)
    existing = await reminders_col().find_one(
        {"_id": target_oid, "user_id": str(user_id)}
    )
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recordatorio no encontrado.",
        )

    update_doc = payload.model_dump(exclude_unset=True)
    if "title" in update_doc:
        cleaned_title = str(update_doc["title"] or "").strip()
        if not cleaned_title:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El título es obligatorio.",
            )
        update_doc["title"] = cleaned_title

    if "note" in update_doc and update_doc["note"] is not None:
        update_doc["note"] = str(update_doc["note"]).strip() or None

    if "due_date" in update_doc and update_doc["due_date"] is not None:
        update_doc["due_date"] = _to_utc_datetime(normalize_dt(update_doc["due_date"]))

    if not update_doc:
        return fix_id(existing)

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

    now = datetime.now(timezone.utc)
    update_doc["updated_at"] = now

    await reminders_col().update_one(
        {"_id": target_oid, "user_id": str(user_id)},
        {"$set": update_doc},
    )

    if should_roll_forward:
        raw_due = update_doc.get("due_date") or existing.get("due_date")
        source_due = normalize_dt(raw_due)
        if source_due:
            next_due = shift_reminder_due_date(source_due, recurrence)
            next_title = str(
                update_doc.get("title") or existing.get("title") or "Recordatorio"
            ).strip()

            # Evitar crear duplicados si ya existe un recordatorio igual programado
            duplicate = await reminders_col().find_one(
                {
                    "user_id": str(user_id),
                    "title": next_title,
                    "due_date": next_due,
                    "is_completed": False,
                }
            )

            if not duplicate and next_due != source_due:
                next_doc = {
                    "user_id": str(user_id),
                    "title": next_title,
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
                await reminders_col().insert_one(next_doc)

    updated = await reminders_col().find_one(
        {"_id": target_oid, "user_id": str(user_id)}
    )
    return fix_id(updated)


@router.delete("/{reminder_id}")
async def delete_reminder(reminder_id: str, user_id: CurrentUserId):
    target_oid = _safe_oid(reminder_id)
    result = await reminders_col().delete_one(
        {"_id": target_oid, "user_id": str(user_id)}
    )
    if result.deleted_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recordatorio no encontrado.",
        )
    return {"status": "success", "message": "Recordatorio eliminado correctamente"}

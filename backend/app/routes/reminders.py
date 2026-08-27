# backend/app/routers/reminders.py
import calendar
from datetime import UTC, datetime
from typing import Annotated, Any, Dict
from fastapi import APIRouter, Depends, HTTPException

from ..core.security import get_current_user_id
from ..db.database import reminders_col
from ..schemas.schemas import ReminderCreate, ReminderUpdate
from ..services.finance import fix_id
from ..utils.helpers import oid

router = APIRouter(prefix="/reminders", tags=["Reminders"])
CurrentUserId = Annotated[str, Depends(get_current_user_id)]


def shift_reminder_due_date(base_due: datetime, recurrence: str) -> datetime:
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


@router.post("")
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


@router.get("")
async def list_reminders(user_id: CurrentUserId, include_completed: bool = True):
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


@router.patch("/{reminder_id}")
async def update_reminder(
    reminder_id: str, payload: ReminderUpdate, user_id: CurrentUserId
):
    existing = await reminders_col().find_one(
        {"_id": oid(reminder_id), "user_id": str(user_id)}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Recordatorio no encontrado")

    update_doc = payload.model_dump(exclude_unset=True)
    if "title" in update_doc:
        cleaned_title = str(update_doc["title"] or "").strip()
        if not cleaned_title:
            raise HTTPException(status_code=400, detail="El título es obligatorio")
        update_doc["title"] = cleaned_title
    if "note" in update_doc and update_doc["note"] is not None:
        update_doc["note"] = str(update_doc["note"]).strip() or None

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

    update_doc["updated_at"] = datetime.now(UTC)
    await reminders_col().update_one(
        {"_id": oid(reminder_id), "user_id": str(user_id)}, {"$set": update_doc}
    )

    if should_roll_forward:
        source_due = update_doc.get("due_date") or existing.get("due_date")
        if isinstance(source_due, datetime):
            next_due = shift_reminder_due_date(source_due, recurrence)
            if next_due != source_due:
                now = datetime.now(UTC)
                next_doc = {
                    "user_id": str(user_id),
                    "title": str(
                        update_doc.get("title")
                        or existing.get("title")
                        or "Recordatorio"
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
                await reminders_col().insert_one(next_doc)

    updated = await reminders_col().find_one(
        {"_id": oid(reminder_id), "user_id": str(user_id)}
    )
    return fix_id(updated)


@router.delete("/{reminder_id}")
async def delete_reminder(reminder_id: str, user_id: CurrentUserId):
    result = await reminders_col().delete_one(
        {"_id": oid(reminder_id), "user_id": str(user_id)}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Recordatorio no encontrado")
    return {"status": "success", "message": "Recordatorio eliminado"}

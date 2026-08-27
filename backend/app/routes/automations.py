# backend/app/routers/automations.py
import calendar
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException

from ..core.security import get_current_user_id
from ..db.database import (
    accounts_col,
    auto_rules_col,
    recurring_templates_col,
    reminders_col,
    tx_col,
)
from ..schemas.schemas import (
    AutoRuleCreate,
    AutoRuleUpdate,
    RecurringTemplateCreate,
    RecurringTemplateUpdate,
)
from ..services.finance import fix_id, get_accounts_balances
from ..utils.helpers import normalize_dt, oid

router = APIRouter(tags=["Automations"])
CurrentUserId = Annotated[str, Depends(get_current_user_id)]


def calculate_due_dates_for_template(
    template: Dict[str, Any], until_dt: datetime
) -> List[datetime]:
    cadence = str(template.get("cadence") or "monthly")
    day_of_month = int(template.get("day_of_month") or 1)
    start_date = (
        normalize_dt(template.get("start_date"))
        or normalize_dt(template.get("created_at"))
        or until_dt
    )
    end_date = normalize_dt(template.get("end_date"))
    last_generated_on = normalize_dt(template.get("last_generated_on"))

    if end_date and end_date < start_date:
        return []

    due_dates: List[datetime] = []
    if cadence == "yearly":
        month_of_year = int(template.get("month_of_year") or start_date.month)
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
        cursor = (
            datetime(cursor.year + 1, 1, 1)
            if cursor.month == 12
            else datetime(cursor.year, cursor.month + 1, 1)
        )
        limit += 1
    return due_dates


async def generate_due_recurring_transactions(
    user_id: str, until: datetime | None = None
) -> int:
    until_dt = normalize_dt(until) or datetime.now()
    templates = (
        await recurring_templates_col()
        .find({"user_id": str(user_id), "is_active": True})
        .to_list(500)
    )
    created_count = 0

    for template in templates:
        due_dates = calculate_due_dates_for_template(template, until_dt)
        latest_generated = None
        for due in due_dates:
            day_start = datetime(due.year, due.month, due.day)
            exists = await tx_col().find_one(
                {
                    "user_id": str(user_id),
                    "recurring_template_id": str(template["_id"]),
                    "date": {"$gte": day_start, "$lt": day_start + timedelta(days=1)},
                }
            )
            if exists:
                latest_generated = due
                continue

            tx_doc = {
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
                    str(template.get("account_id"))
                    if template.get("account_id")
                    else None
                ),
                "note": str(template.get("note") or template.get("name") or ""),
                "date": due,
                "recurring_template_id": str(template["_id"]),
                "created_at": datetime.now(UTC),
            }
            if tx_doc["category_id"]:
                await tx_col().insert_one(tx_doc)
                latest_generated = due
                created_count += 1

        if latest_generated:
            await recurring_templates_col().update_one(
                {"_id": template["_id"], "user_id": str(user_id)},
                {
                    "$set": {
                        "last_generated_on": latest_generated,
                        "updated_at": datetime.now(UTC),
                    }
                },
            )
    return created_count


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
    payload: RecurringTemplateCreate, user_id: CurrentUserId
):
    doc = payload.model_dump()
    now = datetime.now(UTC)
    doc["user_id"] = str(user_id)
    doc["created_at"] = now
    doc["updated_at"] = now
    if doc.get("cadence") == "yearly" and not doc.get("month_of_year"):
        start = normalize_dt(doc.get("start_date")) or now
        doc["month_of_year"] = int(start.month)

    res = await recurring_templates_col().insert_one(doc)
    doc["_id"] = res.inserted_id
    return fix_id(doc)


@router.patch("/automation/recurring/{template_id}")
async def update_recurring_template(
    template_id: str, payload: RecurringTemplateUpdate, user_id: CurrentUserId
):
    existing = await recurring_templates_col().find_one(
        {"_id": oid(template_id), "user_id": str(user_id)}
    )
    if not existing:
        raise HTTPException(
            status_code=404, detail="Plantilla recurrente no encontrada"
        )
    update_doc = payload.model_dump(exclude_unset=True)
    if not update_doc:
        return fix_id(existing)

    update_doc["updated_at"] = datetime.now(UTC)
    await recurring_templates_col().update_one(
        {"_id": oid(template_id), "user_id": str(user_id)}, {"$set": update_doc}
    )
    updated = await recurring_templates_col().find_one(
        {"_id": oid(template_id), "user_id": str(user_id)}
    )
    return fix_id(updated)


@router.delete("/automation/recurring/{template_id}")
async def delete_recurring_template(template_id: str, user_id: CurrentUserId):
    result = await recurring_templates_col().delete_one(
        {"_id": oid(template_id), "user_id": str(user_id)}
    )
    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404, detail="Plantilla recurrente no encontrada"
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
    res = await auto_rules_col().insert_one(doc)
    doc["_id"] = res.inserted_id
    return fix_id(doc)


@router.patch("/automation/rules/{rule_id}")
async def update_automation_rule(
    rule_id: str, payload: AutoRuleUpdate, user_id: CurrentUserId
):
    existing = await auto_rules_col().find_one(
        {"_id": oid(rule_id), "user_id": str(user_id)}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Regla no encontrada")
    update_doc = payload.model_dump(exclude_unset=True)
    if not update_doc:
        return fix_id(existing)

    update_doc["updated_at"] = datetime.now(UTC)
    await auto_rules_col().update_one(
        {"_id": oid(rule_id), "user_id": str(user_id)}, {"$set": update_doc}
    )
    updated = await auto_rules_col().find_one(
        {"_id": oid(rule_id), "user_id": str(user_id)}
    )
    return fix_id(updated)


@router.delete("/automation/rules/{rule_id}")
async def delete_automation_rule(rule_id: str, user_id: CurrentUserId):
    result = await auto_rules_col().delete_one(
        {"_id": oid(rule_id), "user_id": str(user_id)}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Regla no encontrada")
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
    name_map = {str(acc["_id"]): str(acc.get("name") or "Cuenta") for acc in accounts}

    projected_delta_map: Dict[str, float] = dict.fromkeys(name_map.keys(), 0.0)
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
            amount = float(template.get("amount") or 0)
            tx_type = str(template.get("type") or "expense")
            signed_amount = amount if tx_type == "income" else -amount
            account_id = str(template.get("account_id") or "")
            if account_id:
                projected_delta_map[account_id] = (
                    projected_delta_map.get(account_id, 0.0) + signed_amount
                )
            events.append(
                {
                    "date": due.isoformat(),
                    "source": "recurring",
                    "label": str(template.get("name") or "Recurrente"),
                    "type": tx_type,
                    "amount": round(signed_amount, 2),
                    "account_id": account_id or None,
                }
            )

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

    events.sort(key=lambda item: item.get("date") or "")
    accounts_projection = [
        {
            "account_id": acc_id,
            "account_name": acc_name,
            "current_balance": round(balance_map.get(acc_id, 0), 2),
            "projected_delta": round(projected_delta_map.get(acc_id, 0), 2),
            "projected_balance": round(
                balance_map.get(acc_id, 0) + projected_delta_map.get(acc_id, 0), 2
            ),
        }
        for acc_id, acc_name in name_map.items()
    ]

    return {
        "days": forecast_days,
        "from": now.isoformat(),
        "to": horizon.isoformat(),
        "global_current_balance": round(
            sum(item["current_balance"] for item in accounts_projection), 2
        ),
        "global_projected_balance": round(
            sum(item["projected_balance"] for item in accounts_projection), 2
        ),
        "accounts": accounts_projection,
        "events": events[:200],
    }

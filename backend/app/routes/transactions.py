# backend/app/routers/transactions.py
import csv
import io
from datetime import datetime, timedelta
from typing import Annotated, Any, Dict, List, Optional
from fastapi import APIRouter, Body, Depends, HTTPException, Response

from ..core.exceptions import BadRequestError
from ..core.security import get_current_user_id
from ..db.database import accounts_col, auto_rules_col, tx_col
from ..schemas.schemas import CsvImportRequest, TransactionCreate, TransferCreate
from ..services.finance import (
    fix_id,
    get_billing_cycle_bounds,
    parse_date_only,
)
from ..utils.helpers import month_range, normalize_dt, oid

router = APIRouter(tags=["Transactions"])
CurrentUserId = Annotated[str, Depends(get_current_user_id)]


def normalize_rule_text(value: Optional[str]) -> str:
    return str(value or "").strip().lower()


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


def apply_auto_rule(
    payload: Dict[str, Any], rules: List[Dict[str, Any]]
) -> Dict[str, Any]:
    note = str(payload.get("note") or "").strip()
    if not note:
        return payload
    for rule in rules:
        if matches_rule(rule, note):
            if rule.get("type"):
                payload["type"] = rule["type"]
            if rule.get("category_id"):
                payload["category_id"] = str(rule["category_id"])
            if "subcategory_id" in rule:
                payload["subcategory_id"] = (
                    str(rule["subcategory_id"]) if rule.get("subcategory_id") else None
                )
            if "account_id" in rule:
                payload["account_id"] = (
                    str(rule["account_id"]) if rule.get("account_id") else None
                )
            prefix = str(rule.get("note_prefix") or "").strip()
            if prefix:
                payload["note"] = f"{prefix} {note}".strip()
            payload["applied_rule_id"] = str(rule.get("_id"))
            break
    return payload


@router.post("/transactions")
async def create_transaction(tx: TransactionCreate, user_id: CurrentUserId):
    new_tx = tx.model_dump()
    new_tx["user_id"] = str(user_id)
    result = await tx_col().insert_one(new_tx)
    new_tx["_id"] = result.inserted_id
    return fix_id(new_tx)


@router.post("/transfers")
async def create_transfer(payload: TransferCreate, user_id: CurrentUserId):
    if payload.source_account_id == payload.destination_account_id:
        raise HTTPException(
            status_code=400, detail="La cuenta de origen y destino deben ser distintas"
        )

    source = await accounts_col().find_one(
        {"_id": oid(payload.source_account_id), "user_id": str(user_id)}
    )
    destination = await accounts_col().find_one(
        {"_id": oid(payload.destination_account_id), "user_id": str(user_id)}
    )
    if not source or not destination:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

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
    skip: int = 0,
    month: Optional[str] = None,
    cycle: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    account_id: Optional[str] = None,
):
    query: Dict[str, Any] = {"user_id": str(user_id)}
    if limit < 1 or limit > 1000:
        raise BadRequestError("El parámetro limit debe estar entre 1 y 1000")
    if skip < 0:
        raise BadRequestError("El parámetro skip no puede ser negativo")
    if bool(start_date) != bool(end_date):
        raise BadRequestError("Debes indicar start_date y end_date juntos")

    if account_id:
        query["account_id"] = str(account_id).strip()

    if start_date and end_date:
        try:
            start = parse_date_only(start_date)
            end_inclusive = parse_date_only(end_date)
        except ValueError as exc:
            raise BadRequestError(str(exc)) from exc

        if end_inclusive < start:
            raise BadRequestError(
                "La fecha final no puede ser anterior a la fecha inicial"
            )
        query["date"] = {"$gte": start, "$lt": end_inclusive + timedelta(days=1)}
    elif cycle == "current":
        start, end = get_billing_cycle_bounds()
        query["date"] = {"$gte": start, "$lt": end}
    elif month:
        start, end = month_range(month)
        query["date"] = {"$gte": start, "$lt": end}

    cursor = (
        tx_col().find(query).sort([("date", -1), ("_id", -1)]).skip(skip).limit(limit)
    )
    transactions = await cursor.to_list(length=limit)
    return [fix_id(t) for t in transactions]


@router.get("/transactions/export.csv")
async def export_transactions_csv(user_id: CurrentUserId):
    rows = (
        await tx_col()
        .find({"user_id": str(user_id)})
        .sort([("date", -1), ("_id", -1)])
        .to_list(5000)
    )
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
        normalized = normalize_dt(row.get("date"))
        date_text = normalized.isoformat() if normalized else ""
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
        headers={"Content-Disposition": 'attachment; filename="movimientos.csv"'},
    )


@router.post("/transactions/import-csv")
async def import_transactions_csv(payload: CsvImportRequest, user_id: CurrentUserId):
    text = str(payload.csv_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="CSV vacío")

    stream = io.StringIO(text)
    line_offset = 2 if payload.has_header else 1
    imported, skipped, errors = 0, 0, []

    rules: List[Dict[str, Any]] = []
    if payload.apply_rules:
        rules = (
            await auto_rules_col()
            .find({"user_id": str(user_id), "is_active": True})
            .sort("priority", 1)
            .to_list(300)
        )

    if payload.has_header:
        dict_reader = csv.DictReader(stream, delimiter=payload.delimiter)
        for idx, drow in enumerate(dict_reader, start=line_offset):
            try:
                tx_type = str(drow.get("type") or "expense").strip().lower()
                if tx_type not in {"income", "expense"}:
                    raise ValueError("type debe ser income o expense")
                amount = float(drow.get("amount") or 0)
                if amount <= 0:
                    raise ValueError("amount debe ser mayor que 0")

                raw_date = str(drow.get("date") or "").strip()
                tx_date = (
                    datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
                    if raw_date
                    else datetime.now()
                )

                tx_doc: Dict[str, Any] = {
                    "user_id": str(user_id),
                    "type": tx_type,
                    "amount": amount,
                    "category_id": str(drow.get("category_id") or "").strip(),
                    "subcategory_id": str(drow.get("subcategory_id") or "").strip()
                    or None,
                    "account_id": str(drow.get("account_id") or "").strip() or None,
                    "note": str(drow.get("note") or "").strip() or None,
                    "date": tx_date,
                }

                if payload.apply_rules:
                    tx_doc = apply_auto_rule(tx_doc, rules)

                if not tx_doc.get("category_id"):
                    skipped += 1
                    errors.append(f"Línea {idx}: falta category_id")
                    continue

                await tx_col().insert_one(tx_doc)
                imported += 1
            except Exception as exc:
                skipped += 1
                errors.append(f"Línea {idx}: {exc}")
    else:
        list_reader = csv.reader(stream, delimiter=payload.delimiter)
        for idx, lrow in enumerate(list_reader, start=line_offset):
            try:
                if len(lrow) < 7:
                    raise ValueError("Fila incompleta")
                tx_type = str(lrow[1] or "expense").strip().lower()
                if tx_type not in {"income", "expense"}:
                    raise ValueError("type debe ser income o expense")
                amount = float(lrow[2] or 0)
                if amount <= 0:
                    raise ValueError("amount debe ser mayor que 0")

                raw_date = str(lrow[0] or "").strip()
                tx_date = (
                    datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
                    if raw_date
                    else datetime.now()
                )

                tx_doc = {
                    "user_id": str(user_id),
                    "type": tx_type,
                    "amount": amount,
                    "category_id": str(lrow[3] or "").strip(),
                    "subcategory_id": str(lrow[4] or "").strip() or None,
                    "account_id": str(lrow[5] or "").strip() or None,
                    "note": str(lrow[6] or "").strip() or None,
                    "date": tx_date,
                }

                if payload.apply_rules:
                    tx_doc = apply_auto_rule(tx_doc, rules)

                if not tx_doc.get("category_id"):
                    skipped += 1
                    errors.append(f"Línea {idx}: falta category_id")
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


@router.get("/transactions/{tx_id}")
async def get_transaction(tx_id: str, user_id: CurrentUserId):
    tx = await tx_col().find_one({"_id": oid(tx_id), "user_id": str(user_id)})
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return fix_id(tx)


@router.patch("/transactions/{tx_id}")
async def update_transaction(
    tx_id: str, user_id: CurrentUserId, payload: Dict[str, Any] = Body(...)
):
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
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    tx = await tx_col().find_one({"_id": oid(tx_id), "user_id": str(user_id)})
    return fix_id(tx)


@router.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: str, user_id: CurrentUserId):
    result = await tx_col().delete_one({"_id": oid(tx_id), "user_id": str(user_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return {"status": "success", "message": "Movimiento eliminado"}

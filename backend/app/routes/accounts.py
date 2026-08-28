# backend/app/routers/accounts.py
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from pymongo import UpdateOne
from bson.errors import InvalidId

from ..core.security import get_current_user_id
from ..db.database import accounts_col, tx_col
from ..schemas.schemas import AccountCreate, AccountReorder, AccountUpdate
from ..services.finance import fix_id, get_accounts_balances
from ..utils.helpers import oid

router = APIRouter(prefix="/accounts", tags=["Accounts"])
CurrentUserId = Annotated[str, Depends(get_current_user_id)]


def _safe_oid(val: str):
    """Convierte a ObjectId o levanta 404 si el formato es inválido."""
    try:
        return oid(val)
    except (InvalidId, ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Identificador de cuenta inválido.",
        )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_account(payload: AccountCreate, user_id: CurrentUserId):
    doc = payload.model_dump()
    doc["user_id"] = str(user_id)

    last_account = await accounts_col().find_one(
        {"user_id": str(user_id)}, sort=[("order", -1)], projection={"order": 1}
    )
    last_order = int(last_account.get("order", -1)) if last_account else -1
    doc["order"] = last_order + 1

    res = await accounts_col().insert_one(doc)
    doc["_id"] = res.inserted_id
    doc["current_balance"] = float(doc.get("balance_inicial", 0.0))
    return fix_id(doc)


@router.get("")
async def list_accounts(user_id: CurrentUserId):
    cursor = accounts_col().find({"user_id": str(user_id)})
    accounts = await cursor.to_list(length=300)

    balances = await get_accounts_balances(user_id)
    balance_map = {
        b["account_id"]: b["current_balance"] for b in balances if b.get("account_id")
    }

    for a in accounts:
        acc_id = str(a["_id"])
        a["current_balance"] = balance_map.get(
            acc_id, float(a.get("balance_inicial", 0.0))
        )

    accounts.sort(
        key=lambda a: (
            0 if isinstance(a.get("order"), int) else 1,
            int(a.get("order", 10**9)),
            str(a.get("name", "")).lower(),
        )
    )
    return [fix_id(a) for a in accounts]


@router.post("/reorder")
async def reorder_accounts(payload: AccountReorder, user_id: CurrentUserId):
    provided_ids = [acc_id for acc_id in payload.account_ids if acc_id]
    if not provided_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes indicar las cuentas a ordenar.",
        )

    user_accounts = (
        await accounts_col()
        .find({"user_id": str(user_id)}, projection={"_id": 1})
        .to_list(length=300)
    )
    valid_ids = {str(account["_id"]) for account in user_accounts}

    has_duplicates = len(set(provided_ids)) != len(provided_ids)
    if (
        has_duplicates
        or len(provided_ids) != len(valid_ids)
        or set(provided_ids) != valid_ids
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El orden debe incluir todas tus cuentas exactamente una vez.",
        )

    # Actualización masiva en un solo viaje de red
    operations = [
        UpdateOne(
            {"_id": _safe_oid(acc_id), "user_id": str(user_id)},
            {"$set": {"order": index}},
        )
        for index, acc_id in enumerate(provided_ids)
    ]
    if operations:
        await accounts_col().bulk_write(operations, ordered=False)

    return {"status": "success", "message": "Orden actualizado correctamente"}


@router.get("/{account_id}")
async def get_account(account_id: str, user_id: CurrentUserId):
    target_oid = _safe_oid(account_id)
    account = await accounts_col().find_one(
        {"_id": target_oid, "user_id": str(user_id)}
    )
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada."
        )

    # Cálculo eficiente con pipeline de agregación en MongoDB
    pipeline = [
        {"$match": {"user_id": str(user_id), "account_id": str(target_oid)}},
        {
            "$group": {
                "_id": None,
                "net_change": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$type", "income"]},
                            "$amount",
                            {"$multiply": ["$amount", -1]},
                        ]
                    }
                },
            }
        },
    ]
    agg_result = await tx_col().aggregate(pipeline).to_list(length=1)
    net_change = agg_result[0]["net_change"] if agg_result else 0.0
    initial_balance = float(account.get("balance_inicial", 0.0))

    account["current_balance"] = round(initial_balance + net_change, 2)
    return fix_id(account)


@router.patch("/{account_id}")
async def update_account(
    account_id: str, payload: AccountUpdate, user_id: CurrentUserId
):
    target_oid = _safe_oid(account_id)
    account = await accounts_col().find_one(
        {"_id": target_oid, "user_id": str(user_id)}
    )
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada."
        )

    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return fix_id(account)

    await accounts_col().update_one(
        {"_id": target_oid, "user_id": str(user_id)},
        {"$set": update_data},
    )
    updated = await accounts_col().find_one(
        {"_id": target_oid, "user_id": str(user_id)}
    )
    return fix_id(updated)


@router.delete("/{account_id}")
async def delete_account(account_id: str, user_id: CurrentUserId):
    target_oid = _safe_oid(account_id)
    account = await accounts_col().find_one(
        {"_id": target_oid, "user_id": str(user_id)}
    )
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada."
        )

    tx_count = await tx_col().count_documents(
        {"account_id": str(target_oid), "user_id": str(user_id)}
    )
    if tx_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No puedes eliminar una cuenta con transacciones asociadas.",
        )

    await accounts_col().delete_one({"_id": target_oid, "user_id": str(user_id)})
    return {"status": "success", "message": "Cuenta eliminada correctamente"}


@router.post("/{account_id}/reset")
async def reset_account(account_id: str, user_id: CurrentUserId):
    target_oid = _safe_oid(account_id)
    account = await accounts_col().find_one(
        {"_id": target_oid, "user_id": str(user_id)}
    )
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada."
        )

    delete_result = await tx_col().delete_many(
        {"account_id": str(target_oid), "user_id": str(user_id)}
    )
    await accounts_col().update_one(
        {"_id": target_oid, "user_id": str(user_id)},
        {"$set": {"balance_inicial": 0.0}},
    )
    return {
        "status": "success",
        "message": "Cuenta reiniciada",
        "deleted_transactions": delete_result.deleted_count,
    }

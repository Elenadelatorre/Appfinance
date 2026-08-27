# backend/app/routers/accounts.py
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException

from ..core.security import get_current_user_id
from ..db.database import accounts_col, tx_col
from ..schemas.schemas import AccountCreate, AccountReorder, AccountUpdate
from ..services.finance import fix_id, get_accounts_balances
from ..utils.helpers import oid

router = APIRouter(prefix="/accounts", tags=["Accounts"])
CurrentUserId = Annotated[str, Depends(get_current_user_id)]


@router.post("")
async def create_account(payload: AccountCreate, user_id: CurrentUserId):
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


@router.get("")
async def list_accounts(user_id: CurrentUserId):
    cursor = accounts_col().find({"user_id": str(user_id)})
    accounts = await cursor.to_list(100)

    balances = await get_accounts_balances(user_id)
    balance_map = {b["account_id"]: b["current_balance"] for b in balances if b.get("account_id")}
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


@router.post("/reorder")
async def reorder_accounts(payload: AccountReorder, user_id: CurrentUserId):
    provided_ids = [acc_id for acc_id in payload.account_ids if acc_id]
    if not provided_ids:
        raise HTTPException(status_code=400, detail="Debes indicar cuentas")

    user_accounts = await accounts_col().find({"user_id": str(user_id)}).to_list(300)
    valid_ids = {str(account.get("_id")) for account in user_accounts}

    has_duplicates = len(set(provided_ids)) != len(provided_ids)
    if has_duplicates or len(provided_ids) != len(valid_ids) or set(provided_ids) != valid_ids:
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


@router.get("/{account_id}")
async def get_account(account_id: str, user_id: CurrentUserId):
    account = await accounts_col().find_one({"_id": oid(account_id), "user_id": str(user_id)})
    if not account:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

    txs = await tx_col().find({"user_id": str(user_id), "account_id": str(account["_id"])}).to_list(1000)
    total_acc = account.get("balance_inicial", 0)
    for t in txs:
        total_acc += t.get("amount", 0) if t.get("type") == "income" else -t.get("amount", 0)

    account["current_balance"] = round(total_acc, 2)
    return fix_id(account)


@router.patch("/{account_id}")
async def update_account(account_id: str, payload: AccountUpdate, user_id: CurrentUserId):
    account = await accounts_col().find_one({"_id": oid(account_id), "user_id": str(user_id)})
    if not account:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return fix_id(account)

    await accounts_col().update_one(
        {"_id": oid(account_id), "user_id": str(user_id)},
        {"$set": update_data},
    )
    updated = await accounts_col().find_one({"_id": oid(account_id), "user_id": str(user_id)})
    return fix_id(updated)


@router.delete("/{account_id}")
async def delete_account(account_id: str, user_id: CurrentUserId):
    account = await accounts_col().find_one({"_id": oid(account_id), "user_id": str(user_id)})
    if not account:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

    tx_count = await tx_col().count_documents({"account_id": account_id, "user_id": str(user_id)})
    if tx_count > 0:
        raise HTTPException(status_code=409, detail="No puedes eliminar una cuenta con transacciones")

    await accounts_col().delete_one({"_id": oid(account_id)})
    return {"status": "success", "message": "Cuenta eliminada"}


@router.post("/{account_id}/reset")
async def reset_account(account_id: str, user_id: CurrentUserId):
    account = await accounts_col().find_one({"_id": oid(account_id), "user_id": str(user_id)})
    if not account:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

    delete_result = await tx_col().delete_many({"account_id": account_id, "user_id": str(user_id)})
    await accounts_col().update_one(
        {"_id": oid(account_id), "user_id": str(user_id)},
        {"$set": {"balance_inicial": 0}},
    )
    return {
        "status": "success",
        "message": "Cuenta reiniciada",
        "deleted_transactions": delete_result.deleted_count,
    }
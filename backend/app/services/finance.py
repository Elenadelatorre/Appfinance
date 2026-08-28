# backend/app/services/finance.py
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from ..db.database import (
    accounts_col,
    budgets_col,
    cat_sections_col,
    categories_col,
    tx_col,
)

logger = logging.getLogger(__name__)

BILLING_CYCLE_START_DAY = 26
GLOBAL_CATEGORY_QUERY: Dict[str, Any] = {
    "$or": [{"user_id": {"$exists": False}}, {"user_id": None}]
}


def _to_utc_datetime(dt: Optional[datetime]) -> datetime:
    """Garantiza formato datetime timezone-aware en UTC."""
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_date_only(value: str) -> datetime:
    cleaned = str(value or "").strip()
    if not cleaned:
        raise ValueError("La fecha no puede estar vacía")
    try:
        dt = datetime.fromisoformat(f"{cleaned}T00:00:00")
        return _to_utc_datetime(dt)
    except ValueError as exc:
        raise ValueError("Formato de fecha inválido (usa YYYY-MM-DD)") from exc


# --- FUNCIONES AUXILIARES ---
def fix_id(obj: Any) -> Any:
    if obj is None:
        return None
    if isinstance(obj, list):
        return [fix_id(o) for o in obj]
    if isinstance(obj, dict):
        if "_id" in obj:
            sid = str(obj["_id"])
            obj["_id"] = sid
            obj["id"] = sid
        if "parent_id" in obj and obj["parent_id"] is not None:
            obj["parent_id"] = str(obj["parent_id"])
        if "section_id" in obj and obj["section_id"] is not None:
            obj["section_id"] = str(obj["section_id"])
        return obj
    return obj


def get_billing_cycle_bounds(
    reference: Optional[datetime] = None,
    start_day: int = BILLING_CYCLE_START_DAY,
) -> Tuple[datetime, datetime]:
    current = _to_utc_datetime(reference)
    if current.day >= start_day:
        cycle_start = datetime(
            current.year, current.month, start_day, tzinfo=timezone.utc
        )
    elif current.month == 1:
        cycle_start = datetime(current.year - 1, 12, start_day, tzinfo=timezone.utc)
    else:
        cycle_start = datetime(
            current.year, current.month - 1, start_day, tzinfo=timezone.utc
        )

    if cycle_start.month == 12:
        cycle_end = datetime(cycle_start.year + 1, 1, start_day, tzinfo=timezone.utc)
    else:
        cycle_end = datetime(
            cycle_start.year, cycle_start.month + 1, start_day, tzinfo=timezone.utc
        )

    return cycle_start, cycle_end


def get_billing_cycle_period(
    reference: Optional[datetime] = None,
    start_day: int = BILLING_CYCLE_START_DAY,
) -> Tuple[int, int]:
    cycle_start, _ = get_billing_cycle_bounds(reference, start_day)
    return cycle_start.month, cycle_start.year


def get_category_scope_query(user_id: Optional[str] = None) -> Dict[str, Any]:
    if user_id:
        return {"user_id": str(user_id)}
    return dict(GLOBAL_CATEGORY_QUERY)


# --- CÁLCULOS Y RESÚMENES ---
async def get_summary_for_period(
    start_date: datetime,
    end_date_exclusive: datetime,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    start_utc = _to_utc_datetime(start_date)
    end_utc = _to_utc_datetime(end_date_exclusive)

    query: Dict[str, Any] = {
        "date": {"$gte": start_utc, "$lt": end_utc},
        "category_id": {"$nin": ["transfer_out", "transfer_in"]},
    }
    if user_id:
        query["user_id"] = str(user_id)

    cursor = tx_col().find(query)
    transactions = await cursor.to_list(length=2000)

    total_income = 0.0
    total_expense = 0.0
    category_breakdown: Dict[str, float] = {}

    for tx in transactions:
        amount = float(tx.get("amount", 0.0))
        tx_type = tx.get("type", "expense")
        cat_id = str(tx.get("category_id", "sin_categoria"))
        if tx_type == "income":
            total_income += amount
        else:
            total_expense += amount
            category_breakdown[cat_id] = round(
                category_breakdown.get(cat_id, 0.0) + amount, 2
            )

    period_end = end_utc - timedelta(days=1)
    return {
        "month": start_utc.strftime("%B"),
        "total_income": round(total_income, 2),
        "total_expense": round(total_expense, 2),
        "balance": round(total_income - total_expense, 2),
        "category_breakdown": category_breakdown,
        "period_start": start_utc.isoformat(),
        "period_end": period_end.isoformat(),
        "cycle_start_day": BILLING_CYCLE_START_DAY,
    }


async def get_monthly_summary(user_id: Optional[str] = None) -> Dict[str, Any]:
    start_of_cycle, end_of_cycle = get_billing_cycle_bounds()
    return await get_summary_for_period(start_of_cycle, end_of_cycle, user_id)


async def get_accounts_balances(user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Calcula el balance de todas las cuentas usando una sola agregación de MongoDB."""
    query = {} if not user_id else {"user_id": str(user_id)}
    accounts = await accounts_col().find(query).to_list(length=300)

    # Pipeline de agregación para sumar movimientos agrupados por account_id
    pipeline = [
        {"$match": query},
        {
            "$group": {
                "_id": "$account_id",
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

    agg_results = await tx_col().aggregate(pipeline).to_list(length=500)
    deltas_by_account = {
        str(r["_id"]): float(r.get("net_change", 0.0))
        for r in agg_results
        if r["_id"] is not None and str(r["_id"]).strip() != ""
    }

    # Transacciones no asignadas a ninguna cuenta
    unassigned_net = next(
        (
            float(r.get("net_change", 0.0))
            for r in agg_results
            if r["_id"] is None or str(r["_id"]).strip() == ""
        ),
        0.0,
    )

    balances_reales = []
    for account in accounts:
        acc_id = str(account["_id"])
        initial = float(account.get("balance_inicial", 0.0))
        delta = deltas_by_account.get(acc_id, 0.0)
        balances_reales.append(
            {
                "account_id": acc_id,
                "account_name": account.get("name", "Cuenta"),
                "current_balance": round(initial + delta, 2),
            }
        )

    if unassigned_net != 0.0 or not balances_reales:
        balances_reales.append(
            {
                "account_id": None,
                "account_name": "Sin cuenta",
                "current_balance": round(unassigned_net, 2),
            }
        )

    return balances_reales


async def check_budgets_logic(user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    start_of_cycle, _ = get_billing_cycle_bounds()
    query: Dict[str, Any] = {"month": start_of_cycle.month, "year": start_of_cycle.year}
    if user_id:
        query["user_id"] = str(user_id)

    budgets = await budgets_col().find(query).to_list(length=200)
    summary = await get_monthly_summary(user_id)
    expenses_by_cat = summary.get("category_breakdown", {})
    category_scope = get_category_scope_query(user_id)

    all_cats = await categories_col().find(category_scope).to_list(length=500)
    cat_map = {str(c["_id"]): c.get("name", "Desconocida") for c in all_cats}

    analysis = []
    for b in budgets:
        cat_id = str(b.get("category_id", ""))
        spent = float(expenses_by_cat.get(cat_id, 0.0))
        limit = float(b.get("limit_amount", 0.0))
        remaining = limit - spent
        percentage = (spent / limit) * 100 if limit > 0 else 0.0

        analysis.append(
            {
                "budget_id": str(b.get("_id")),
                "category_id": cat_id,
                "category": cat_map.get(cat_id, "Desconocida"),
                "limit": limit,
                "spent": round(spent, 2),
                "remaining": round(remaining, 2),
                "percentage": f"{round(percentage, 1)}%",
                "status": "🔴 Excedido" if remaining < 0 else "🟢 En control",
            }
        )
    return analysis


# --- SEED DE DATOS ---
async def seed_initial_categories() -> None:
    try:
        if await cat_sections_col().count_documents({}) == 0:
            secciones_base = [
                {"name": "Ingresos", "order": 1},
                {"name": "Gastos", "order": 2},
                {"name": "Ahorro e Inversión", "order": 3},
            ]
            await cat_sections_col().insert_many(secciones_base)

        sec_ingresos = await cat_sections_col().find_one({"name": "Ingresos"})
        sec_gastos = await cat_sections_col().find_one({"name": "Gastos"})
        sec_ahorro = await cat_sections_col().find_one({"name": "Ahorro e Inversión"})

        if not sec_ingresos or not sec_gastos or not sec_ahorro:
            return

        id_i, id_g = str(sec_ingresos["_id"]), str(sec_gastos["_id"])

        categorias_con_subs = [
            ("Nómina", "💼", "#16a34a", id_i, []),
            ("Extras", "✨", "#22c55e", id_i, []),
            ("Regalos", "🎁", "#10b981", id_i, []),
            ("Intereses", "📈", "#14b8a6", id_i, []),
            ("Ventas", "🏷️", "#0ea5a4", id_i, []),
            ("Hogar", "🏠", "#f97316", id_g, ["Alquiler", "Otros"]),
            ("Suministros", "💡", "#fb7185", id_g, ["Luz", "Agua"]),
            ("Alimentación", "🍎", "#f59e0b", id_g, ["Supermercado", "UberEat"]),
            (
                "Restaurantes",
                "🍽️",
                "#ef4444",
                id_g,
                ["Desayuno/Snack", "Comida", "Cena"],
            ),
            (
                "Ocio",
                "🎨",
                "#8b5cf6",
                id_g,
                ["Viajes", "Conciertos/Cine", "Hobbies", "Eventos"],
            ),
            (
                "Personal",
                "🧘",
                "#ec4899",
                id_g,
                ["Médico", "Peluquería", "Deporte", "Aseo"],
            ),
            ("Compras", "🛍️", "#a855f7", id_g, ["Ropa", "Tecnología", "Otros"]),
            (
                "Transporte",
                "🚗",
                "#2563eb",
                id_g,
                [
                    "Letra Coche",
                    "Gasolina",
                    "Transporte público/Uber",
                    "Peajes",
                    "Mantenimiento",
                ],
            ),
            ("Regalos", "🎀", "#f43f5e", id_g, []),
            ("Invitación", "🥂", "#eab308", id_g, []),
            ("Suscripciones", "📱", "#6366f1", id_g, ["Netflix", "Spotify", "iCloud"]),
            ("Deudores", "🤝", "#06b6d4", id_g, []),
            ("Inversiones", "📊", "#059669", id_g, []),
            ("Ahorro", "🏦", "#0d9488", id_g, ["Trade Republic", "Hucha digital"]),
            ("Traspaso cuentas", "🔁", "#0284c7", id_g, []),
            ("Seguros", "🛡️", "#64748b", id_g, ["Coche", "Moto"]),
            ("Varios", "🧩", "#78716c", id_g, []),
        ]

        for cat_name, icon, color, section_id, subs in categorias_con_subs:
            existing_parent = await categories_col().find_one(
                {"name": cat_name, "section_id": section_id, "parent_id": None}
            )
            if existing_parent:
                await categories_col().update_one(
                    {"_id": existing_parent["_id"]},
                    {"$set": {"icon": icon, "color": color}},
                )
                cat_id = str(existing_parent["_id"])
            else:
                res = await categories_col().insert_one(
                    {
                        "name": cat_name,
                        "icon": icon,
                        "color": color,
                        "section_id": section_id,
                        "parent_id": None,
                    }
                )
                cat_id = str(res.inserted_id)

            for sub_name in subs:
                existing_sub = await categories_col().find_one(
                    {"name": sub_name, "parent_id": cat_id}
                )
                if existing_sub:
                    await categories_col().update_one(
                        {"_id": existing_sub["_id"]},
                        {
                            "$set": {
                                "icon": icon,
                                "color": color,
                                "section_id": section_id,
                            }
                        },
                    )
                else:
                    await categories_col().insert_one(
                        {
                            "name": sub_name,
                            "icon": icon,
                            "color": color,
                            "section_id": section_id,
                            "parent_id": cat_id,
                        }
                    )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("seed_initial_categories falló: %s", exc)


async def seed_categories_for_user(user_id: str) -> None:
    scoped_user_id = str(user_id)
    existing_user_category = await categories_col().find_one(
        {"user_id": scoped_user_id}
    )
    if existing_user_category:
        return

    global_categories = (
        await categories_col().find(get_category_scope_query()).to_list(length=1000)
    )
    if not global_categories:
        await seed_initial_categories()
        global_categories = (
            await categories_col().find(get_category_scope_query()).to_list(length=1000)
        )

    if not global_categories:
        return

    parents = [item for item in global_categories if not item.get("parent_id")]
    children = [item for item in global_categories if item.get("parent_id")]
    parents.sort(
        key=lambda item: (
            int(item.get("order", 0)) if str(item.get("order", "")).strip() else 0,
            str(item.get("name", "")).lower(),
        )
    )
    children.sort(
        key=lambda item: (
            str(item.get("parent_id")),
            int(item.get("order", 0)) if str(item.get("order", "")).strip() else 0,
            str(item.get("name", "")).lower(),
        )
    )

    parent_id_map: Dict[str, str] = {}

    for parent in parents:
        clone = {
            "user_id": scoped_user_id,
            "name": parent.get("name"),
            "section_id": str(parent.get("section_id")),
            "icon": parent.get("icon", "🧾"),
            "color": parent.get("color", "#4F46E5"),
            "image_data": parent.get("image_data"),
            "bg_color": parent.get("bg_color"),
            "border_color": parent.get("border_color"),
            "parent_id": None,
            "order": int(parent.get("order", 0) or 0),
        }
        result = await categories_col().insert_one(clone)
        parent_id_map[str(parent.get("_id"))] = str(result.inserted_id)

    for child in children:
        parent_id = parent_id_map.get(str(child.get("parent_id")))
        if not parent_id:
            continue
        clone = {
            "user_id": scoped_user_id,
            "name": child.get("name"),
            "section_id": str(child.get("section_id")),
            "icon": child.get("icon", "🧾"),
            "color": child.get("color", "#4F46E5"),
            "image_data": child.get("image_data"),
            "bg_color": child.get("bg_color"),
            "border_color": child.get("border_color"),
            "parent_id": parent_id,
            "order": int(child.get("order", 0) or 0),
        }
        await categories_col().insert_one(clone)


async def seed_default_accounts_for_user(user_id: str) -> None:
    try:
        desired = [
            {"name": "Santander · Principal", "type": "bank", "balance_inicial": 0.0},
            {
                "name": "Santander · Hucha digital",
                "type": "bank",
                "balance_inicial": 0.0,
            },
            {
                "name": "Trade Republic · Ahorros",
                "type": "bank",
                "balance_inicial": 0.0,
            },
            {"name": "Imagin · Común", "type": "bank", "balance_inicial": 0.0},
        ]

        for acc in desired:
            existing = await accounts_col().find_one(
                {"user_id": str(user_id), "name": acc["name"]}
            )
            if existing:
                continue

            doc = {
                "user_id": str(user_id),
                "name": acc["name"],
                "type": acc["type"],
                "balance_inicial": acc["balance_inicial"],
            }
            await accounts_col().insert_one(doc)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("seed_default_accounts_for_user(%s) falló: %s", user_id, exc)

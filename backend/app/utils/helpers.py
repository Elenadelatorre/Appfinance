# backend/app/utils/helpers.py
import re
from datetime import UTC, datetime
from typing import Any, Dict, Optional
from bson import ObjectId
from ..core.exceptions import BadRequestError

DEFAULT_USER_SETTINGS = {
    "default_view": "home",
    "reduce_motion": False,
    "profile_avatar": "auto",
    "accent_color": "#6366f1",
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

    accent = str(raw.get("accent_color") or "").strip()
    if re.fullmatch(r"#[0-9a-fA-F]{6}", accent):
        settings["accent_color"] = accent.lower()

    return settings


def oid(id_: str) -> ObjectId:
    try:
        return ObjectId(id_)
    except Exception:
        raise BadRequestError("ID de base de datos inválido")


def month_range(month: str) -> tuple[datetime, datetime]:
    try:
        start = datetime.fromisoformat(month + "-01T00:00:00")
        year, m = start.year, start.month
        end = datetime(year + 1, 1, 1) if m == 12 else datetime(year, m + 1, 1)
        return start, end
    except Exception:
        raise BadRequestError("Formato de mes inválido (usa YYYY-MM)")


def normalize_dt(value: Any) -> Optional[datetime]:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    return value

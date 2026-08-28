# backend/app/utils/helpers.py
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
from bson import ObjectId
from bson.errors import InvalidId

from ..core.exceptions import BadRequestError

DEFAULT_USER_SETTINGS = {
    "default_view": "home",
    "reduce_motion": False,
    "profile_avatar": "auto",
    "accent_color": "#6366f1",
}

VALID_VIEWS = {"home", "dashboard", "history", "stats", "accounts", "reminders"}
VALID_AVATARS = {"auto", "🙂", "😎", "🧠", "💼", "💸", "🚀"}


def normalize_user_settings(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    settings = dict(DEFAULT_USER_SETTINGS)
    if not isinstance(raw, dict):
        return settings

    default_view = str(raw.get("default_view") or "").strip()
    if default_view in VALID_VIEWS:
        settings["default_view"] = default_view

    settings["reduce_motion"] = bool(raw.get("reduce_motion", False))

    avatar = str(raw.get("profile_avatar") or "").strip()
    if avatar in VALID_AVATARS:
        settings["profile_avatar"] = avatar

    accent = str(raw.get("accent_color") or "").strip()
    if re.fullmatch(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})", accent):
        settings["accent_color"] = accent.lower()

    return settings


def oid(id_: Any) -> ObjectId:
    if isinstance(id_, ObjectId):
        return id_
    try:
        return ObjectId(str(id_))
    except (InvalidId, TypeError, ValueError):
        raise BadRequestError("Identificador de base de datos inválido.")


def month_range(month: str) -> Tuple[datetime, datetime]:
    cleaned = str(month or "").strip()
    if not re.fullmatch(r"^\d{4}-(?:0[1-9]|1[0-2])$", cleaned):
        raise BadRequestError("Formato de mes inválido (usa YYYY-MM).")
    try:
        start = datetime.fromisoformat(f"{cleaned}-01T00:00:00+00:00")
        year, m = start.year, start.month
        end = (
            datetime(year + 1, 1, 1, tzinfo=timezone.utc)
            if m == 12
            else datetime(year, m + 1, 1, tzinfo=timezone.utc)
        )
        return start, end
    except Exception as exc:
        raise BadRequestError("Error al calcular el rango del mes.") from exc


def normalize_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        try:
            dt = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except ValueError:
            return None
    return None

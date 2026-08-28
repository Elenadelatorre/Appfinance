# backend/app/schemas/schemas.py
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# Tipos definidos
TxType = Literal["income", "expense"]
AccType = Literal["cash", "bank", "credit"]
UserDefaultView = Literal[
    "home", "dashboard", "history", "stats", "accounts", "reminders"
]
ReminderType = Literal["insurance", "subscription", "other"]
ReminderRecurrence = Literal["none", "monthly", "yearly"]
AutomationCadence = Literal["monthly", "yearly"]
RuleMatchMode = Literal["contains", "starts_with", "equals"]


def _validate_password_strength(v: str) -> str:
    if len(v) < 6:
        raise ValueError("La contraseña debe tener al menos 6 caracteres.")
    return v


def _validate_hex_color(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    cleaned = v.strip()
    if not re.fullmatch(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})", cleaned):
        raise ValueError("Formato de color hexadecimal inválido (ej. #4F46E5 o #FFF).")
    return cleaned.lower()


# --- USUARIOS ---
class UserCreate(BaseModel):
    """Modelo para crear nuevo usuario."""

    email: EmailStr = Field(..., description="Correo electrónico único")
    password: str = Field(
        ..., min_length=6, max_length=128, description="Contraseña (mín 6 caracteres)"
    )

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        return _validate_password_strength(v)


class ChangePasswordRequest(BaseModel):
    """Modelo para cambio de contraseña del usuario autenticado."""

    current_password: str = Field(
        ..., min_length=1, max_length=128, description="Contraseña actual"
    )
    new_password: str = Field(
        ...,
        min_length=6,
        max_length=128,
        description="Nueva contraseña (mín 6 caracteres)",
    )

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        return _validate_password_strength(v)


class UserSettingsUpdate(BaseModel):
    default_view: Optional[UserDefaultView] = None
    reduce_motion: Optional[bool] = None
    profile_avatar: Optional[str] = Field(default=None, max_length=16)
    accent_color: Optional[str] = Field(default=None, max_length=7)

    @field_validator("profile_avatar")
    @classmethod
    def validate_profile_avatar(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {"auto", "🙂", "😎", "🧠", "💼", "💸", "🚀"}
        if v not in allowed:
            raise ValueError("Avatar no permitido")
        return v

    @field_validator("accent_color")
    @classmethod
    def validate_accent_color(cls, v: Optional[str]) -> Optional[str]:
        return _validate_hex_color(v)


# --- CUENTAS ---
class AccountCreate(BaseModel):
    """Modelo para crear nueva cuenta de dinero."""

    name: str = Field(
        ..., min_length=1, max_length=50, description="Nombre de la cuenta"
    )
    type: AccType = Field(default="bank", description="Tipo de cuenta")
    balance_inicial: float = Field(default=0.0, description="Saldo inicial")
    icon: Optional[str] = Field(default=None, max_length=8)
    image_data: Optional[str] = Field(default=None)
    bg_color: Optional[str] = Field(default=None)
    border_color: Optional[str] = Field(default=None)

    @field_validator("bg_color", "border_color")
    @classmethod
    def validate_colors(cls, v: Optional[str]) -> Optional[str]:
        return _validate_hex_color(v)


class AccountUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    type: Optional[AccType] = Field(default=None)
    balance_inicial: Optional[float] = Field(default=None)
    icon: Optional[str] = Field(default=None, max_length=8)
    image_data: Optional[str] = Field(default=None)
    bg_color: Optional[str] = Field(default=None)
    border_color: Optional[str] = Field(default=None)

    @field_validator("bg_color", "border_color")
    @classmethod
    def validate_colors(cls, v: Optional[str]) -> Optional[str]:
        return _validate_hex_color(v)


class AccountReorder(BaseModel):
    account_ids: List[str] = Field(min_length=1)


class TransferCreate(BaseModel):
    source_account_id: str
    destination_account_id: str
    amount: float = Field(gt=0)
    description: Optional[str] = "Transferencia entre cuentas"
    date: datetime = Field(default_factory=_utc_now)


# --- CATEGORÍAS Y SECCIONES ---
class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    section_id: str
    icon: str = Field(default="🧾")
    color: str = Field(default="#4F46E5")
    image_data: Optional[str] = Field(default=None)
    bg_color: Optional[str] = Field(default=None)
    border_color: Optional[str] = Field(default=None)
    parent_id: Optional[str] = None
    order: int = 0

    @field_validator("color", "bg_color", "border_color")
    @classmethod
    def validate_colors(cls, v: Optional[str]) -> Optional[str]:
        return _validate_hex_color(v)


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    section_id: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    image_data: Optional[str] = None
    bg_color: Optional[str] = None
    border_color: Optional[str] = None
    parent_id: Optional[str] = None
    order: Optional[int] = None

    @field_validator("color", "bg_color", "border_color")
    @classmethod
    def validate_colors(cls, v: Optional[str]) -> Optional[str]:
        return _validate_hex_color(v)


# --- TRANSACCIONES ---
class TransactionCreate(BaseModel):
    amount: float = Field(gt=0)
    type: TxType
    category_id: str
    account_id: Optional[str] = None
    subcategory_id: Optional[str] = None
    note: Optional[str] = None
    date: datetime = Field(default_factory=_utc_now)


class TransactionUpdate(BaseModel):
    amount: Optional[float] = Field(default=None, gt=0)
    type: Optional[TxType] = None
    category_id: Optional[str] = None
    subcategory_id: Optional[str] = None
    account_id: Optional[str] = None
    note: Optional[str] = None
    date: Optional[datetime] = None


# --- PRESUPUESTOS ---
class BudgetCreate(BaseModel):
    category_id: str
    limit_amount: float = Field(gt=0)
    month: int = Field(default_factory=lambda: _utc_now().month, ge=1, le=12)
    year: int = Field(default_factory=lambda: _utc_now().year, ge=2020, le=2100)


# --- RECORDATORIOS ---
class ReminderCreate(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    due_date: datetime
    amount: Optional[float] = Field(default=None, ge=0)
    type: ReminderType = Field(default="other")
    recurrence: ReminderRecurrence = Field(default="none")
    auto_advance: bool = Field(default=True)
    note: Optional[str] = Field(default=None, max_length=240)
    is_completed: bool = Field(default=False)


class ReminderUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=80)
    due_date: Optional[datetime] = None
    amount: Optional[float] = Field(default=None, ge=0)
    type: Optional[ReminderType] = None
    recurrence: Optional[ReminderRecurrence] = None
    auto_advance: Optional[bool] = None
    note: Optional[str] = Field(default=None, max_length=240)
    is_completed: Optional[bool] = None


# --- AUTOMATIZACIONES ---
class RecurringTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: TxType
    amount: float = Field(gt=0)
    category_id: str = Field(min_length=1)
    subcategory_id: Optional[str] = None
    account_id: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=200)
    cadence: AutomationCadence = "monthly"
    day_of_month: int = Field(default=1, ge=1, le=31)
    month_of_year: Optional[int] = Field(default=None, ge=1, le=12)
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    is_active: bool = True


class RecurringTemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    type: Optional[TxType] = None
    amount: Optional[float] = Field(default=None, gt=0)
    category_id: Optional[str] = None
    subcategory_id: Optional[str] = None
    account_id: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=200)
    cadence: Optional[AutomationCadence] = None
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    month_of_year: Optional[int] = Field(default=None, ge=1, le=12)
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    is_active: Optional[bool] = None


class AutoRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    keyword: str = Field(min_length=1, max_length=120)
    match_mode: RuleMatchMode = "contains"
    type: Optional[TxType] = None
    category_id: Optional[str] = None
    subcategory_id: Optional[str] = None
    account_id: Optional[str] = None
    note_prefix: Optional[str] = Field(default=None, max_length=120)
    priority: int = Field(default=100, ge=1, le=999)
    is_active: bool = True


class AutoRuleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    keyword: Optional[str] = Field(default=None, min_length=1, max_length=120)
    match_mode: Optional[RuleMatchMode] = None
    type: Optional[TxType] = None
    category_id: Optional[str] = None
    subcategory_id: Optional[str] = None
    account_id: Optional[str] = None
    note_prefix: Optional[str] = Field(default=None, max_length=120)
    priority: Optional[int] = Field(default=None, ge=1, le=999)
    is_active: Optional[bool] = None


class CsvImportRequest(BaseModel):
    csv_text: str = Field(min_length=1)
    has_header: bool = True
    delimiter: str = Field(default=",", min_length=1, max_length=1)
    apply_rules: bool = True


class ForecastRequest(BaseModel):
    days: int = Field(default=30, ge=1, le=365)

from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, Field, EmailStr, field_validator
from typing import Optional, Literal
from app.logic import get_billing_cycle_period

# Tipos definidos
TxType = Literal["income", "expense"]
AccType = Literal["cash", "bank", "credit"]


def _validate_password_strength(v: str) -> str:
    if not any(char.isupper() for char in v):
        raise ValueError("Contraseña debe contener al menos una mayúscula")
    if not any(char.isdigit() for char in v):
        raise ValueError("Contraseña debe contener al menos un número")
    return v


# --- USUARIOS ---
class UserCreate(BaseModel):
    """Modelo para crear nuevo usuario"""

    email: EmailStr = Field(..., description="Correo electrónico único")
    password: str = Field(
        ..., min_length=8, max_length=128, description="Contraseña (mín 8 caracteres)"
    )

    @field_validator("password")
    @classmethod
    def validate_password(cls, v):
        return _validate_password_strength(v)


class ChangePasswordRequest(BaseModel):
    """Modelo para cambio de contraseña del usuario autenticado"""

    current_password: str = Field(
        ..., min_length=1, max_length=128, description="Contraseña actual"
    )
    new_password: str = Field(
        ..., min_length=8, max_length=128, description="Nueva contraseña"
    )

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v):
        return _validate_password_strength(v)


UserDefaultView = Literal[
    "home", "dashboard", "history", "stats", "accounts", "reminders"
]


class UserSettingsUpdate(BaseModel):
    default_view: Optional[UserDefaultView] = None
    reduce_motion: Optional[bool] = None
    profile_avatar: Optional[str] = Field(default=None, max_length=16)

    @field_validator("profile_avatar")
    @classmethod
    def validate_profile_avatar(cls, v):
        if v is None:
            return v
        allowed = {"auto", "🙂", "😎", "🧠", "💼", "💸", "🚀"}
        if v not in allowed:
            raise ValueError("Avatar no permitido")
        return v


# --- CUENTAS ---
class AccountCreate(BaseModel):
    """Modelo para crear nueva cuenta de dinero"""

    name: str = Field(
        ..., min_length=1, max_length=50, description="Nombre de la cuenta"
    )
    type: AccType = Field(default="bank", description="Tipo de cuenta")
    balance_inicial: float = Field(default=0.0, ge=0, description="Saldo inicial")
    icon: Optional[str] = Field(default=None, max_length=8)
    image_data: Optional[str] = Field(default=None)
    bg_color: Optional[str] = Field(default=None)
    border_color: Optional[str] = Field(default=None)


class AccountUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    type: Optional[AccType] = Field(default=None)
    balance_inicial: Optional[float] = Field(default=None, ge=0)
    icon: Optional[str] = Field(default=None, max_length=8)
    image_data: Optional[str] = Field(default=None)
    bg_color: Optional[str] = Field(default=None)
    border_color: Optional[str] = Field(default=None)


class AccountReorder(BaseModel):
    account_ids: list[str] = Field(min_length=1)


class TransferCreate(BaseModel):
    source_account_id: str
    destination_account_id: str
    amount: float = Field(gt=0)
    description: Optional[str] = "Transferencia entre cuentas"
    date: datetime = Field(default_factory=datetime.now)


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


# --- TRANSACCIONES ---
class TransactionCreate(BaseModel):
    amount: float = Field(gt=0)
    type: TxType
    category_id: str
    account_id: Optional[str] = None
    subcategory_id: Optional[str] = None
    note: Optional[str] = None
    date: datetime = Field(default_factory=datetime.now)


# --- PRESUPUESTOS ---
class BudgetCreate(BaseModel):
    category_id: str
    limit_amount: float = Field(gt=0)
    month: int = Field(
        default_factory=lambda: get_billing_cycle_period()[0], ge=1, le=12
    )
    year: int = Field(default_factory=lambda: get_billing_cycle_period()[1], ge=2024)


# --- RECORDATORIOS ---
ReminderType = Literal["insurance", "subscription", "other"]
ReminderRecurrence = Literal["none", "monthly", "yearly"]


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
AutomationCadence = Literal["monthly", "yearly"]
RuleMatchMode = Literal["contains", "starts_with", "equals"]


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

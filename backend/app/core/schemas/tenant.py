from datetime import date, datetime
from pydantic import BaseModel


class TenantCreate(BaseModel):
    name: str
    slug: str
    plan: str = "standard"
    gst_number: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    phone: str | None = None
    email: str | None = None
    max_users: int = 5
    license_start: date | None = None
    license_end: date | None = None
    owner_email: str
    owner_name: str = "Owner"
    products: list[str] = ["video"]


class TenantUpdate(BaseModel):
    name: str | None = None
    plan: str | None = None
    gst_number: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    phone: str | None = None
    email: str | None = None
    logo_url: str | None = None
    primary_color: str | None = None
    max_users: int | None = None
    license_end: date | None = None
    amc_active: bool | None = None
    is_active: bool | None = None
    owner_name: str | None = None
    owner_email: str | None = None


class TenantResponse(BaseModel):
    id: int
    name: str
    slug: str
    plan: str
    gst_number: str | None
    address: str | None
    city: str | None
    state: str | None
    pin_code: str | None = None
    phone: str | None
    email: str | None
    logo_url: str | None
    primary_color: str | None
    max_users: int = 5
    license_start: date | None = None
    license_end: date | None = None
    amc_active: bool = True
    is_active: bool = True
    settings: dict = {}
    created_at: datetime | None = None
    products: list[str] = []
    owner_name: str | None = None
    owner_email: str | None = None

    model_config = {"from_attributes": True}


class PaymentCreate(BaseModel):
    amount_minor: int
    currency: str = "INR"
    payment_date: date
    payment_type: str
    period_start: date | None = None
    period_end: date | None = None
    method: str | None = None
    reference: str | None = None
    notes: str | None = None


class PaymentOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    tenant_id: int
    amount_minor: int
    currency: str
    payment_date: date
    payment_type: str
    period_start: date | None = None
    period_end: date | None = None
    method: str | None = None
    reference: str | None = None
    notes: str | None = None

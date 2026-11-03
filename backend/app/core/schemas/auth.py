from typing import Literal, Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class LoginRequest(BaseModel):
    email: str
    password: str
    code: str | None = None


class GoogleLoginRequest(BaseModel):
    token: str
    code: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UserSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    theme: dict[str, str] = {}
    language: Optional[Literal["en", "hi", "mr", "bn", "ta", "te"]] = None


class UserSettingsUpdate(BaseModel):
    theme: Optional[dict[str, str]] = None
    language: Optional[Literal["en", "hi", "mr", "bn", "ta", "te"]] = None


class UserResponse(BaseModel):
    id: int
    tenant_id: int | None = None
    email: str
    name: str
    role: str
    is_active: bool
    products: list[str] = []
    last_login: datetime | None = None
    phone: str | None = None
    tenant_name: str | None = None
    settings: dict = {}
    email_verified: bool = True
    totp_enabled: bool = False
    must_enrol_totp: bool = False
    impersonated_by: dict | None = None

    model_config = {"from_attributes": True}

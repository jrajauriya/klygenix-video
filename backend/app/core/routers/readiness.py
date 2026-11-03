from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.core.middleware.auth import require_admin_tenant
from app.core.models.user import User
from app.core.services import readiness
from app.database import get_db

router = APIRouter(prefix="/api/admin", tags=["admin-readiness"])


class ReadinessCheckOut(BaseModel):
    key: str
    title: str
    group: str
    severity: str
    ok: bool
    detail: str
    fix: str


class ReadinessOut(BaseModel):
    ready: bool
    blocking_failed: int
    warnings: int
    checked_at: str
    checks: list[ReadinessCheckOut]


@router.get("/readiness", response_model=ReadinessOut)
def readiness_report(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tenant("admin.settings")),
):
    checks = readiness.evaluate(settings, mode="app") + readiness.evaluate_db(db, settings)
    return readiness.summarise(checks)

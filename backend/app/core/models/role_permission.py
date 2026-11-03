from sqlalchemy import String, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RolePermission(Base):
    """Gate two: what a role may reach. Set by the tenant owner.

    The unique constraint is load-bearing, not decorative: every permission save is a
    scoped delete followed by inserts, and without it a concurrent save can leave two
    rows for one (tenant, role, key) and the read picks whichever comes first. The
    master estate declares it in the DDL and omits it from the model, so a database
    built from models alone loses it silently.
    """

    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "role", "permission_key", name="uq_role_permissions_tenant_role_key"),
        {"schema": "kv_admin"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("kv_admin.tenants.id"), index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    permission_key: Mapped[str] = mapped_column(String(100), nullable=False)
    access_level: Mapped[str] = mapped_column(String(10), default="full")

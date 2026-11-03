"""device tokens for push alerts

Revision ID: kv0000000004
Revises: kv0000000003
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "kv0000000004"
down_revision: Union[str, None] = "kv0000000003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "device_tokens",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=300), nullable=False),
        sa.Column("platform", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("platform IN ('ios','android','web')", name="ck_device_tokens_platform"),
        sa.ForeignKeyConstraint(["tenant_id"], ["kv_admin.tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["kv_admin.users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
        schema="kv_social",
    )
    op.create_index(op.f("ix_kv_social_device_tokens_tenant_id"), "device_tokens", ["tenant_id"], unique=False, schema="kv_social")
    op.create_index(op.f("ix_kv_social_device_tokens_user_id"), "device_tokens", ["user_id"], unique=False, schema="kv_social")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON kv_social.device_tokens TO klygenix_video_app")
    op.execute("GRANT USAGE, SELECT ON SEQUENCE kv_social.device_tokens_id_seq TO klygenix_video_app")
    op.execute("SELECT kv_admin.apply_tenancy()")


def downgrade() -> None:
    op.drop_index(op.f("ix_kv_social_device_tokens_user_id"), table_name="device_tokens", schema="kv_social")
    op.drop_index(op.f("ix_kv_social_device_tokens_tenant_id"), table_name="device_tokens", schema="kv_social")
    op.drop_table("device_tokens", schema="kv_social")

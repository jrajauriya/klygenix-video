"""sign in with google

Revision ID: kv0000000021
Revises: kv0000000020
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'kv0000000021'
down_revision: Union[str, None] = 'kv0000000020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("google_sub", sa.String(64), nullable=True), schema="kv_admin")
    op.create_index("ux_users_google_sub", "users", ["google_sub"], unique=True, schema="kv_admin",
                    postgresql_where=sa.text("google_sub IS NOT NULL"))


def downgrade() -> None:
    op.drop_index("ux_users_google_sub", table_name="users", schema="kv_admin")
    op.drop_column("users", "google_sub", schema="kv_admin")

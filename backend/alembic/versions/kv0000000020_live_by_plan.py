"""live streaming by plan

Revision ID: kv0000000020
Revises: kv0000000019
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'kv0000000020'
down_revision: Union[str, None] = 'kv0000000019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for key, on in (("creator_free", "false"), ("creator_pro", "true"), ("creator_business", "true")):
        op.execute(f"UPDATE kv_commerce.plans SET limits = limits || '{{\"live\": {on}}}'::jsonb WHERE key = '{key}'")


def downgrade() -> None:
    op.execute("UPDATE kv_commerce.plans SET limits = limits - 'live'")

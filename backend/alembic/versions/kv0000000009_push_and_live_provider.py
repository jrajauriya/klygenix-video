"""push message log and the live provider reference

Revision ID: kv0000000009
Revises: kv0000000008
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'kv0000000009'
down_revision: Union[str, None] = 'kv0000000008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('push_messages',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('body', sa.String(length=300), nullable=False),
    sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('dedupe_key', sa.String(length=120), nullable=True),
    sa.Column('provider', sa.String(length=10), nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('tokens', sa.Integer(), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('sent','failed','skipped')", name='ck_push_messages_status'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('dedupe_key', name='uq_push_messages_dedupe'),
    schema='kv_social'
    )
    op.create_index('idx_push_messages_user', 'push_messages', ['user_id', 'created_at'], unique=False, schema='kv_social')
    op.create_index(op.f('ix_kv_social_push_messages_tenant_id'), 'push_messages', ['tenant_id'], unique=False, schema='kv_social')
    op.add_column('live_streams', sa.Column('provider_ref', sa.String(length=80), nullable=True), schema='kv_media')
    op.execute("SELECT kv_admin.apply_tenancy()")

def downgrade() -> None:
    op.drop_column('live_streams', 'provider_ref', schema='kv_media')
    op.drop_index(op.f('ix_kv_social_push_messages_tenant_id'), table_name='push_messages', schema='kv_social')
    op.drop_index('idx_push_messages_user', table_name='push_messages', schema='kv_social')
    op.drop_table('push_messages', schema='kv_social')

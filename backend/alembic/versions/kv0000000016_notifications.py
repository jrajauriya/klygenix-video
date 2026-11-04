"""notifications

Revision ID: kv0000000016
Revises: kv0000000015
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'kv0000000016'
down_revision: Union[str, None] = 'kv0000000015'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('notifications',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('title', sa.String(length=160), nullable=False),
    sa.Column('body', sa.String(length=300), server_default='', nullable=False),
    sa.Column('url', sa.String(length=300), nullable=True),
    sa.Column('image', sa.String(length=500), nullable=True),
    sa.Column('dedupe_key', sa.String(length=120), nullable=True),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('digest_sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('dedupe_key', name='uq_notifications_dedupe'),
    schema='kv_social'
    )
    op.create_index('idx_notifications_digest', 'notifications', ['digest_sent_at', 'read_at'], unique=False, schema='kv_social')
    op.create_index('idx_notifications_user', 'notifications', ['user_id', 'created_at'], unique=False, schema='kv_social')
    op.create_index(op.f('ix_kv_social_notifications_tenant_id'), 'notifications', ['tenant_id'], unique=False, schema='kv_social')
    op.execute("SELECT kv_admin.apply_tenancy()")


def downgrade() -> None:
    op.drop_index(op.f('ix_kv_social_notifications_tenant_id'), table_name='notifications', schema='kv_social')
    op.drop_index('idx_notifications_user', table_name='notifications', schema='kv_social')
    op.drop_index('idx_notifications_digest', table_name='notifications', schema='kv_social')
    op.drop_table('notifications', schema='kv_social')

"""reco model

Revision ID: kv0000000013
Revises: kv0000000012
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'kv0000000013'
down_revision: Union[str, None] = 'kv0000000012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('reco_impressions',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('video_id', sa.BigInteger(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('surface', sa.String(length=8), nullable=False),
    sa.Column('arm', sa.String(length=10), nullable=False),
    sa.Column('shown_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('clicked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('labelled', sa.Boolean(), server_default='false', nullable=False),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_ai'
    )
    op.create_index('idx_reco_impressions_shown', 'reco_impressions', ['shown_at'], unique=False, schema='kv_ai')
    op.create_index('idx_reco_impressions_user', 'reco_impressions', ['user_id', 'shown_at'], unique=False, schema='kv_ai')
    op.create_table('reco_models',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('version', sa.String(length=20), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('features', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('weights', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('bias', sa.Float(), nullable=False),
    sa.Column('mean', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('std', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('metrics', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('trained_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('promoted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('promoted_by', sa.Integer(), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.CheckConstraint("status IN ('candidate','active','retired','rejected')", name='ck_reco_models_status'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('version', name='uq_reco_models_version'),
    schema='kv_ai'
    )
    op.execute("SELECT kv_admin.apply_tenancy()")


def downgrade() -> None:
    op.drop_table('reco_models', schema='kv_ai')
    op.drop_index('idx_reco_impressions_user', table_name='reco_impressions', schema='kv_ai')
    op.drop_index('idx_reco_impressions_shown', table_name='reco_impressions', schema='kv_ai')
    op.drop_table('reco_impressions', schema='kv_ai')

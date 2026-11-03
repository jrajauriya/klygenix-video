"""live — streams, live chat and paid live messages, super chats and gifts in the checkout

Revision ID: kv0000000008
Revises: kv0000000007
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'kv0000000008'
down_revision: Union[str, None] = 'kv0000000007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PURPOSES = "'plan','tip','boost','membership','video','series','superchat','gift'"
OLD = "'plan','tip','boost','membership','video','series'"


def upgrade() -> None:
    op.create_table('live_streams',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('channel_id', sa.BigInteger(), nullable=False),
    sa.Column('public_id', sa.String(length=16), nullable=False),
    sa.Column('title', sa.String(length=160), nullable=False),
    sa.Column('description', sa.Text(), server_default='', nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('provider', sa.String(length=12), nullable=False),
    sa.Column('ingest_port', sa.Integer(), nullable=True),
    sa.Column('stream_key', sa.Text(), nullable=False),
    sa.Column('stream_key_hash', sa.String(length=64), nullable=False),
    sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('slow_mode_seconds', sa.Integer(), server_default='0', nullable=False),
    sa.Column('members_rank', sa.SmallInteger(), nullable=True),
    sa.Column('replay_enabled', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('replay_video_id', sa.BigInteger(), nullable=True),
    sa.Column('peak_viewers', sa.Integer(), server_default='0', nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('scheduled','live','ended','failed')", name='ck_live_streams_status'),
    sa.ForeignKeyConstraint(['channel_id'], ['kv_social.channels.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('public_id', name='uq_live_streams_public_id'),
    schema='kv_media'
    )
    op.create_index('idx_live_streams_status', 'live_streams', ['status', 'started_at'], unique=False, schema='kv_media')
    op.create_index(op.f('ix_kv_media_live_streams_tenant_id'), 'live_streams', ['tenant_id'], unique=False, schema='kv_media')
    op.create_table('live_messages',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('stream_id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('author_name', sa.String(length=80), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('body', sa.String(length=300), server_default='', nullable=False),
    sa.Column('paid_minor', sa.Integer(), server_default='0', nullable=False),
    sa.Column('tier', sa.String(length=20), nullable=True),
    sa.Column('pinned_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('checkout_id', sa.BigInteger(), nullable=True),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('chat','superchat','gift')", name='ck_live_messages_kind'),
    sa.CheckConstraint("status IN ('visible','hidden','deleted')", name='ck_live_messages_status'),
    sa.ForeignKeyConstraint(['stream_id'], ['kv_media.live_streams.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_social'
    )
    op.create_index('idx_live_messages_stream', 'live_messages', ['stream_id', 'created_at'], unique=False, schema='kv_social')
    op.create_index(op.f('ix_kv_social_live_messages_tenant_id'), 'live_messages', ['tenant_id'], unique=False, schema='kv_social')

    op.drop_constraint("ck_checkouts_purpose", "checkouts", schema="kv_commerce", type_="check")
    op.create_check_constraint("ck_checkouts_purpose", "checkouts", f"purpose IN ({PURPOSES})", schema="kv_commerce")
    op.execute("SELECT kv_admin.apply_tenancy()")
    op.execute("DROP POLICY IF EXISTS public_read ON kv_media.live_streams")
    op.execute("CREATE POLICY public_read ON kv_media.live_streams FOR SELECT USING (status IN ('scheduled','live','ended'))")
    op.execute("DROP POLICY IF EXISTS public_read ON kv_social.live_messages")
    op.execute("CREATE POLICY public_read ON kv_social.live_messages FOR SELECT USING (status = 'visible')")


def downgrade() -> None:
    op.execute("DELETE FROM kv_commerce.checkouts WHERE purpose IN ('superchat','gift')")
    op.drop_constraint("ck_checkouts_purpose", "checkouts", schema="kv_commerce", type_="check")
    op.create_check_constraint("ck_checkouts_purpose", "checkouts", f"purpose IN ({OLD})", schema="kv_commerce")
    op.drop_index(op.f('ix_kv_social_live_messages_tenant_id'), table_name='live_messages', schema='kv_social')
    op.drop_index('idx_live_messages_stream', table_name='live_messages', schema='kv_social')
    op.drop_table('live_messages', schema='kv_social')
    op.drop_index(op.f('ix_kv_media_live_streams_tenant_id'), table_name='live_streams', schema='kv_media')
    op.drop_index('idx_live_streams_status', table_name='live_streams', schema='kv_media')
    op.drop_table('live_streams', schema='kv_media')

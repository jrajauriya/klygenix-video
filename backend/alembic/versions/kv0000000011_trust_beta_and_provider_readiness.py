"""trust beta and provider readiness

Revision ID: kv0000000011
Revises: kv0000000010
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'kv0000000011'
down_revision: Union[str, None] = 'kv0000000010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('feedback',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('tenant_id', sa.Integer(), nullable=True),
    sa.Column('email', sa.String(length=200), nullable=True),
    sa.Column('kind', sa.String(length=6), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('page', sa.String(length=300), server_default='', nullable=False),
    sa.Column('app', sa.String(length=12), server_default='web', nullable=False),
    sa.Column('app_version', sa.String(length=40), server_default='', nullable=False),
    sa.Column('user_agent', sa.String(length=300), server_default='', nullable=False),
    sa.Column('screenshot_key', sa.String(length=300), nullable=True),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('admin_note', sa.Text(), server_default='', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('bug','idea','other')", name='ck_feedback_kind'),
    sa.CheckConstraint("status IN ('new','triaged','done','wontfix')", name='ck_feedback_status'),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_admin'
    )
    op.create_index('idx_feedback_status', 'feedback', ['status', 'created_at'], unique=False, schema='kv_admin')
    op.create_table('invite_codes',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('code_hash', sa.String(length=64), nullable=False),
    sa.Column('hint', sa.String(length=12), nullable=False),
    sa.Column('role', sa.String(length=8), nullable=False),
    sa.Column('note', sa.String(length=200), server_default='', nullable=False),
    sa.Column('email', sa.String(length=200), nullable=True),
    sa.Column('max_uses', sa.Integer(), nullable=False),
    sa.Column('used', sa.Integer(), server_default='0', nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("role IN ('viewer','creator')", name='ck_invite_codes_role'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code_hash', name='uq_invite_codes_hash'),
    schema='kv_admin'
    )
    op.create_table('mail_outbox',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('template', sa.String(length=40), nullable=False),
    sa.Column('language', sa.String(length=8), nullable=False),
    sa.Column('to_email', sa.String(length=200), nullable=False),
    sa.Column('subject', sa.String(length=200), nullable=False),
    sa.Column('body_html', sa.Text(), nullable=False),
    sa.Column('body_text', sa.Text(), server_default='', nullable=False),
    sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('provider', sa.String(length=10), nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('tenant_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('captured','sent','failed','skipped')", name='ck_mail_outbox_status'),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_admin'
    )
    op.create_index('idx_mail_outbox_to', 'mail_outbox', ['to_email', 'created_at'], unique=False, schema='kv_admin')
    op.create_table('waitlist',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('email', sa.String(length=200), nullable=False),
    sa.Column('name', sa.String(length=120), server_default='', nullable=False),
    sa.Column('role', sa.String(length=8), nullable=False),
    sa.Column('country', sa.String(length=2), server_default='IN', nullable=False),
    sa.Column('language', sa.String(length=8), server_default='en', nullable=False),
    sa.Column('note', sa.Text(), server_default='', nullable=False),
    sa.Column('channel_url', sa.String(length=300), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('confirm_hash', sa.String(length=64), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('invited_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('invite_id', sa.BigInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("role IN ('viewer','creator','brand')", name='ck_waitlist_role'),
    sa.CheckConstraint("status IN ('pending','confirmed','invited','joined','removed')", name='ck_waitlist_status'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email', name='uq_waitlist_email'),
    schema='kv_admin'
    )
    op.create_index('idx_waitlist_status', 'waitlist', ['status', 'created_at'], unique=False, schema='kv_admin')
    op.add_column('live_streams', sa.Column('replay_ref', sa.String(length=80), nullable=True), schema='kv_media')
    op.add_column('push_messages', sa.Column('tickets', postgresql.JSONB(astext_type=sa.Text()), nullable=True), schema='kv_social')
    op.add_column('push_messages', sa.Column('receipts_checked_at', sa.DateTime(timezone=True), nullable=True), schema='kv_social')
    op.alter_column('moderation_actions', 'target_type',
               existing_type=sa.VARCHAR(length=8),
               type_=sa.String(length=16),
               existing_nullable=False,
               schema='kv_trust')
    op.alter_column('reports', 'target_type',
               existing_type=sa.VARCHAR(length=8),
               type_=sa.String(length=16),
               existing_nullable=False,
               schema='kv_trust')
    op.add_column('takedowns', sa.Column('countered_at', sa.DateTime(timezone=True), nullable=True), schema='kv_trust')
    op.add_column('takedowns', sa.Column('restore_due_at', sa.DateTime(timezone=True), nullable=True), schema='kv_trust')
    op.add_column('takedowns', sa.Column('legal_action_at', sa.DateTime(timezone=True), nullable=True), schema='kv_trust')
    for table, name in (("reports", "ck_reports_target"), ("moderation_actions", "ck_moderation_actions_target")):
        op.drop_constraint(name, table, schema="kv_trust", type_="check")
        op.create_check_constraint(name, table, "target_type IN ('video','comment','danmaku','channel','live','live_message')", schema="kv_trust")
    op.drop_constraint("ck_takedowns_status", "takedowns", schema="kv_trust", type_="check")
    op.create_check_constraint("ck_takedowns_status", "takedowns", "status IN ('received','acknowledged','actioned','rejected','countered','restored','upheld')", schema="kv_trust")
    op.execute("SELECT kv_admin.apply_tenancy()")


def downgrade() -> None:
    op.execute("DELETE FROM kv_trust.reports WHERE target_type IN ('live','live_message')")
    op.execute("DELETE FROM kv_trust.moderation_actions WHERE target_type IN ('live','live_message')")
    op.execute("UPDATE kv_trust.takedowns SET status = 'actioned' WHERE status = 'upheld'")
    for table, name in (("reports", "ck_reports_target"), ("moderation_actions", "ck_moderation_actions_target")):
        op.drop_constraint(name, table, schema="kv_trust", type_="check")
        op.create_check_constraint(name, table, "target_type IN ('video','comment','danmaku','channel')", schema="kv_trust")
    op.drop_constraint("ck_takedowns_status", "takedowns", schema="kv_trust", type_="check")
    op.create_check_constraint("ck_takedowns_status", "takedowns", "status IN ('received','acknowledged','actioned','rejected','countered','restored')", schema="kv_trust")
    op.drop_column('takedowns', 'legal_action_at', schema='kv_trust')
    op.drop_column('takedowns', 'restore_due_at', schema='kv_trust')
    op.drop_column('takedowns', 'countered_at', schema='kv_trust')
    op.alter_column('reports', 'target_type',
               existing_type=sa.String(length=16),
               type_=sa.VARCHAR(length=8),
               existing_nullable=False,
               schema='kv_trust')
    op.alter_column('moderation_actions', 'target_type',
               existing_type=sa.String(length=16),
               type_=sa.VARCHAR(length=8),
               existing_nullable=False,
               schema='kv_trust')
    op.drop_column('push_messages', 'receipts_checked_at', schema='kv_social')
    op.drop_column('push_messages', 'tickets', schema='kv_social')
    op.drop_column('live_streams', 'replay_ref', schema='kv_media')
    op.drop_index('idx_waitlist_status', table_name='waitlist', schema='kv_admin')
    op.drop_table('waitlist', schema='kv_admin')
    op.drop_index('idx_mail_outbox_to', table_name='mail_outbox', schema='kv_admin')
    op.drop_table('mail_outbox', schema='kv_admin')
    op.drop_table('invite_codes', schema='kv_admin')
    op.drop_index('idx_feedback_status', table_name='feedback', schema='kv_admin')
    op.drop_table('feedback', schema='kv_admin')

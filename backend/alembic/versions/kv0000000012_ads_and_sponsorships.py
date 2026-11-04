"""ads and sponsorships

Revision ID: kv0000000012
Revises: kv0000000011
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'kv0000000012'
down_revision: Union[str, None] = 'kv0000000011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('ad_campaigns',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('public_id', sa.String(length=16), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('creative_video_id', sa.BigInteger(), nullable=True),
    sa.Column('click_url', sa.String(length=500), nullable=False),
    sa.Column('cpm_minor', sa.Integer(), nullable=False),
    sa.Column('budget_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('spent_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('accrued_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('refunded_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('daily_cap_minor', sa.BigInteger(), nullable=True),
    sa.Column('start_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('end_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('targeting', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('skip_after_seconds', sa.SmallInteger(), server_default='5', nullable=False),
    sa.Column('review_note', sa.Text(), nullable=True),
    sa.Column('reviewed_by', sa.Integer(), nullable=True),
    sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('draft','review','active','paused','rejected','ended')", name='ck_ad_campaigns_status'),
    sa.CheckConstraint('cpm_minor > 0', name='ck_ad_campaigns_cpm'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('public_id', name='uq_ad_campaigns_public_id'),
    schema='kv_commerce'
    )
    op.create_index('idx_ad_campaigns_status', 'ad_campaigns', ['status', 'start_at'], unique=False, schema='kv_commerce')
    op.create_index(op.f('ix_kv_commerce_ad_campaigns_tenant_id'), 'ad_campaigns', ['tenant_id'], unique=False, schema='kv_commerce')
    op.create_table('ad_daily',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('campaign_id', sa.BigInteger(), nullable=False),
    sa.Column('video_id', sa.BigInteger(), nullable=False),
    sa.Column('channel_tenant_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('impressions', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('completes', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('skips', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('clicks', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('spend_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('campaign_id', 'video_id', 'day', name='uq_ad_daily'),
    schema='kv_commerce'
    )
    op.create_index('idx_ad_daily_channel', 'ad_daily', ['channel_tenant_id', 'day'], unique=False, schema='kv_commerce')
    op.create_index(op.f('ix_kv_commerce_ad_daily_tenant_id'), 'ad_daily', ['tenant_id'], unique=False, schema='kv_commerce')
    op.create_table('ad_payouts',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('period', sa.String(length=7), nullable=False),
    sa.Column('impressions', sa.BigInteger(), nullable=False),
    sa.Column('spend_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('share_bps', sa.Integer(), nullable=False),
    sa.Column('share_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('route_transfer_id', sa.BigInteger(), nullable=True),
    sa.Column('note', sa.String(length=300), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('pending','released','failed','skipped')", name='ck_ad_payouts_status'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'period', name='uq_ad_payouts_period'),
    schema='kv_commerce'
    )
    op.create_index(op.f('ix_kv_commerce_ad_payouts_tenant_id'), 'ad_payouts', ['tenant_id'], unique=False, schema='kv_commerce')
    op.create_table('brand_profiles',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('website', sa.String(length=300), nullable=True),
    sa.Column('gstin', sa.String(length=15), nullable=True),
    sa.Column('state_code', sa.String(length=2), nullable=True),
    sa.Column('contact_email', sa.String(length=200), nullable=False),
    sa.Column('about', sa.Text(), server_default='', nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('active','suspended')", name='ck_brand_profiles_status'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', name='uq_brand_profiles_tenant'),
    schema='kv_commerce'
    )
    op.create_index(op.f('ix_kv_commerce_brand_profiles_tenant_id'), 'brand_profiles', ['tenant_id'], unique=False, schema='kv_commerce')
    op.create_table('sponsor_applications',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('brief_id', sa.BigInteger(), nullable=False),
    sa.Column('channel_id', sa.BigInteger(), nullable=False),
    sa.Column('pitch', sa.Text(), nullable=False),
    sa.Column('quote_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('applied','accepted','declined','withdrawn')", name='ck_sponsor_applications_status'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('brief_id', 'channel_id', name='uq_sponsor_applications'),
    schema='kv_commerce'
    )
    op.create_index(op.f('ix_kv_commerce_sponsor_applications_tenant_id'), 'sponsor_applications', ['tenant_id'], unique=False, schema='kv_commerce')
    op.create_table('sponsor_briefs',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('public_id', sa.String(length=16), nullable=False),
    sa.Column('title', sa.String(length=160), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('deliverable', sa.String(length=12), nullable=False),
    sa.Column('budget_min_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('budget_max_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('languages', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('min_followers', sa.Integer(), server_default='0', nullable=False),
    sa.Column('deadline', sa.Date(), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("deliverable IN ('dedicated','integration','reel','post')", name='ck_sponsor_briefs_deliverable'),
    sa.CheckConstraint("status IN ('open','closed','cancelled')", name='ck_sponsor_briefs_status'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('public_id', name='uq_sponsor_briefs_public_id'),
    schema='kv_commerce'
    )
    op.create_index('idx_sponsor_briefs_open', 'sponsor_briefs', ['status', 'created_at'], unique=False, schema='kv_commerce')
    op.create_index(op.f('ix_kv_commerce_sponsor_briefs_tenant_id'), 'sponsor_briefs', ['tenant_id'], unique=False, schema='kv_commerce')
    op.create_table('sponsor_deals',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('public_id', sa.String(length=16), nullable=False),
    sa.Column('brief_id', sa.BigInteger(), nullable=True),
    sa.Column('application_id', sa.BigInteger(), nullable=True),
    sa.Column('channel_id', sa.BigInteger(), nullable=False),
    sa.Column('channel_tenant_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=160), nullable=False),
    sa.Column('deliverables', sa.Text(), nullable=False),
    sa.Column('price_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('checkout_id', sa.BigInteger(), nullable=True),
    sa.Column('split_id', sa.BigInteger(), nullable=True),
    sa.Column('video_id', sa.BigInteger(), nullable=True),
    sa.Column('funded_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('approve_by', sa.DateTime(timezone=True), nullable=True),
    sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('auto_approved', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('dispute_reason', sa.Text(), nullable=True),
    sa.Column('resolution_note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('proposed','funded','delivered','approved','disputed','refunded','cancelled')", name='ck_sponsor_deals_status'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('public_id', name='uq_sponsor_deals_public_id'),
    schema='kv_commerce'
    )
    op.create_index('idx_sponsor_deals_channel', 'sponsor_deals', ['channel_tenant_id', 'status'], unique=False, schema='kv_commerce')
    op.create_index(op.f('ix_kv_commerce_sponsor_deals_tenant_id'), 'sponsor_deals', ['tenant_id'], unique=False, schema='kv_commerce')
    op.alter_column('checkouts', 'purpose',
               existing_type=sa.VARCHAR(length=10),
               type_=sa.String(length=16),
               existing_nullable=False,
               schema='kv_commerce')
    op.add_column('videos', sa.Column('ads_enabled', sa.Boolean(), server_default='true', nullable=False), schema='kv_media')
    op.add_column('videos', sa.Column('sponsor_deal_id', sa.BigInteger(), nullable=True), schema='kv_media')
    op.add_column('channels', sa.Column('ads_enabled', sa.Boolean(), server_default='false', nullable=False), schema='kv_social')
    op.drop_constraint("ck_checkouts_purpose", "checkouts", schema="kv_commerce", type_="check")
    op.create_check_constraint("ck_checkouts_purpose", "checkouts", "purpose IN ('plan','tip','boost','membership','video','series','superchat','gift','ad_budget','sponsorship')", schema="kv_commerce")
    op.drop_constraint("ck_route_transfers_kind", "route_transfers", schema="kv_commerce", type_="check")
    op.create_check_constraint("ck_route_transfers_kind", "route_transfers", "kind IN ('sale','reserve','recovery','ad_share')", schema="kv_commerce")
    op.execute("SELECT kv_admin.apply_tenancy()")


def downgrade() -> None:
    op.execute("DELETE FROM kv_commerce.route_transfers WHERE kind = 'ad_share'")
    op.drop_constraint("ck_route_transfers_kind", "route_transfers", schema="kv_commerce", type_="check")
    op.create_check_constraint("ck_route_transfers_kind", "route_transfers", "kind IN ('sale','reserve','recovery')", schema="kv_commerce")
    op.drop_constraint("ck_checkouts_purpose", "checkouts", schema="kv_commerce", type_="check")
    op.create_check_constraint("ck_checkouts_purpose", "checkouts", "purpose IN ('plan','tip','boost','membership','video','series','superchat','gift')", schema="kv_commerce")
    op.drop_column('channels', 'ads_enabled', schema='kv_social')
    op.drop_column('videos', 'sponsor_deal_id', schema='kv_media')
    op.drop_column('videos', 'ads_enabled', schema='kv_media')
    op.alter_column('checkouts', 'purpose',
               existing_type=sa.String(length=16),
               type_=sa.VARCHAR(length=10),
               existing_nullable=False,
               schema='kv_commerce')
    op.drop_index(op.f('ix_kv_commerce_sponsor_deals_tenant_id'), table_name='sponsor_deals', schema='kv_commerce')
    op.drop_index('idx_sponsor_deals_channel', table_name='sponsor_deals', schema='kv_commerce')
    op.drop_table('sponsor_deals', schema='kv_commerce')
    op.drop_index(op.f('ix_kv_commerce_sponsor_briefs_tenant_id'), table_name='sponsor_briefs', schema='kv_commerce')
    op.drop_index('idx_sponsor_briefs_open', table_name='sponsor_briefs', schema='kv_commerce')
    op.drop_table('sponsor_briefs', schema='kv_commerce')
    op.drop_index(op.f('ix_kv_commerce_sponsor_applications_tenant_id'), table_name='sponsor_applications', schema='kv_commerce')
    op.drop_table('sponsor_applications', schema='kv_commerce')
    op.drop_index(op.f('ix_kv_commerce_brand_profiles_tenant_id'), table_name='brand_profiles', schema='kv_commerce')
    op.drop_table('brand_profiles', schema='kv_commerce')
    op.drop_index(op.f('ix_kv_commerce_ad_payouts_tenant_id'), table_name='ad_payouts', schema='kv_commerce')
    op.drop_table('ad_payouts', schema='kv_commerce')
    op.drop_index(op.f('ix_kv_commerce_ad_daily_tenant_id'), table_name='ad_daily', schema='kv_commerce')
    op.drop_index('idx_ad_daily_channel', table_name='ad_daily', schema='kv_commerce')
    op.drop_table('ad_daily', schema='kv_commerce')
    op.drop_index(op.f('ix_kv_commerce_ad_campaigns_tenant_id'), table_name='ad_campaigns', schema='kv_commerce')
    op.drop_index('idx_ad_campaigns_status', table_name='ad_campaigns', schema='kv_commerce')
    op.drop_table('ad_campaigns', schema='kv_commerce')

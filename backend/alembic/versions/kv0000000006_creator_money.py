"""creator money — payout accounts, splits, Route transfers, refunds, tiers, prices, paid comments and boosts

Revision ID: kv0000000006
Revises: kv0000000005
"""
from typing import Sequence, Union

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'kv0000000006'
down_revision: Union[str, None] = 'kv0000000005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ['kv_commerce.creator_splits', 'kv_commerce.payout_accounts', 'kv_commerce.membership_tiers', 'kv_commerce.route_transfers', 'kv_commerce.refunds']
WITHHOLDING = [
    ("TCS52", 50, 0, "2024-07-10", "CGST Act s.52 — 0.5% on net taxable value; confirm with CA"),
    ("194O", 10, 50000000, "2024-10-01", "Income-tax Act s.194-O — 0.1%; individual/HUF under Rs 5 lakh a year exempt; confirm with CA"),
    ("194O_NOPAN", 500, 0, "2024-10-01", "Income-tax Act s.194-O with s.206AA — no PAN; confirm with CA"),
]
COMMISSION = {"creator_free": 2000, "creator_pro": 1000, "creator_business": 800}


def upgrade() -> None:
    op.create_table('creator_splits',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('source_key', sa.String(length=40), nullable=False),
    sa.Column('purpose', sa.String(length=12), nullable=False),
    sa.Column('checkout_id', sa.BigInteger(), nullable=True),
    sa.Column('payment_id', sa.BigInteger(), nullable=True),
    sa.Column('reference', sa.String(length=40), nullable=False),
    sa.Column('paid_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('gross_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('taxable_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('seller_tax_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('seller_gstin', sa.String(length=15), nullable=True),
    sa.Column('seller_pan', sa.String(length=10), nullable=True),
    sa.Column('place_of_supply', sa.String(length=2), nullable=True),
    sa.Column('commission_bps', sa.Integer(), nullable=False),
    sa.Column('commission_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('commission_cgst_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('commission_sgst_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('commission_igst_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('tcs_rate_bps', sa.Integer(), nullable=False),
    sa.Column('tcs_cgst_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('tcs_sgst_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('tcs_igst_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('tds_rate_bps', sa.Integer(), nullable=False),
    sa.Column('tds_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('reserve_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('creator_net_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('refunded_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('commission_invoice_id', sa.BigInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('source_key', name='uq_creator_splits_source'),
    schema='kv_commerce'
    )
    op.create_index('ix_creator_splits_tenant_paid', 'creator_splits', ['tenant_id', 'paid_at'], unique=False, schema='kv_commerce')
    op.create_index(op.f('ix_kv_commerce_creator_splits_tenant_id'), 'creator_splits', ['tenant_id'], unique=False, schema='kv_commerce')
    op.create_table('payout_accounts',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('business_type', sa.String(length=20), nullable=False),
    sa.Column('legal_name', sa.String(length=200), nullable=False),
    sa.Column('contact_name', sa.String(length=120), nullable=False),
    sa.Column('email', sa.String(length=200), nullable=False),
    sa.Column('phone', sa.String(length=20), nullable=False),
    sa.Column('pan', sa.String(length=10), nullable=True),
    sa.Column('gstin', sa.String(length=15), nullable=True),
    sa.Column('address', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('beneficiary_name', sa.String(length=120), nullable=True),
    sa.Column('ifsc', sa.String(length=11), nullable=True),
    sa.Column('account_number', sa.Text(), nullable=True),
    sa.Column('account_last4', sa.String(length=4), nullable=True),
    sa.Column('gateway_account_id', sa.String(length=40), nullable=True),
    sa.Column('gateway_stakeholder_id', sa.String(length=40), nullable=True),
    sa.Column('gateway_product_id', sa.String(length=40), nullable=True),
    sa.Column('requirements', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('activated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("business_type IN ('individual','proprietorship','partnership','private_limited','public_limited','llp','trust','society','ngo')", name='ck_payout_accounts_business_type'),
    sa.CheckConstraint("status IN ('draft','submitted','under_review','needs_clarification','activated','suspended','rejected')", name='ck_payout_accounts_status'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', name='uq_payout_accounts_tenant'),
    schema='kv_commerce'
    )
    op.create_index(op.f('ix_kv_commerce_payout_accounts_tenant_id'), 'payout_accounts', ['tenant_id'], unique=False, schema='kv_commerce')
    op.create_table('membership_tiers',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('channel_id', sa.BigInteger(), nullable=False),
    sa.Column('name', sa.String(length=60), nullable=False),
    sa.Column('rank', sa.Integer(), nullable=False),
    sa.Column('price_inr_minor', sa.Integer(), nullable=False),
    sa.Column('perks', sa.Text(), server_default='', nullable=False),
    sa.Column('badge', sa.String(length=16), server_default='Member', nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('price_inr_minor > 0', name='ck_membership_tiers_price'),
    sa.CheckConstraint('rank BETWEEN 1 AND 5', name='ck_membership_tiers_rank'),
    sa.ForeignKeyConstraint(['channel_id'], ['kv_social.channels.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('channel_id', 'rank', name='uq_membership_tiers_rank'),
    schema='kv_commerce'
    )
    op.create_index(op.f('ix_kv_commerce_membership_tiers_tenant_id'), 'membership_tiers', ['tenant_id'], unique=False, schema='kv_commerce')
    op.create_table('route_transfers',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('payout_account_id', sa.BigInteger(), nullable=True),
    sa.Column('split_id', sa.BigInteger(), nullable=True),
    sa.Column('kind', sa.String(length=8), nullable=False),
    sa.Column('amount_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('reversed_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('hold_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('gateway_transfer_id', sa.String(length=40), nullable=True),
    sa.Column('released_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('recovered_by_id', sa.BigInteger(), nullable=True),
    sa.Column('note', sa.String(length=200), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('sale','reserve','recovery')", name='ck_route_transfers_kind'),
    sa.CheckConstraint("status IN ('pending','held','released','reversed','recovered','failed')", name='ck_route_transfers_status'),
    sa.ForeignKeyConstraint(['payout_account_id'], ['kv_commerce.payout_accounts.id'], ),
    sa.ForeignKeyConstraint(['split_id'], ['kv_commerce.creator_splits.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_commerce'
    )
    op.create_index(op.f('ix_kv_commerce_route_transfers_tenant_id'), 'route_transfers', ['tenant_id'], unique=False, schema='kv_commerce')
    op.create_index('ix_route_transfers_release', 'route_transfers', ['status', 'hold_until'], unique=False, schema='kv_commerce')
    op.create_index('uq_route_transfers_split_kind', 'route_transfers', ['split_id', 'kind'], unique=True, schema='kv_commerce', postgresql_where="kind IN ('sale','reserve')")
    op.create_table('refunds',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('payment_id', sa.BigInteger(), nullable=False),
    sa.Column('checkout_id', sa.BigInteger(), nullable=False),
    sa.Column('amount_minor', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('reason', sa.String(length=200), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('gateway_refund_id', sa.String(length=80), nullable=True),
    sa.Column('credit_note_id', sa.BigInteger(), nullable=True),
    sa.Column('actor_user_id', sa.Integer(), nullable=True),
    sa.Column('idempotency_key', sa.String(length=80), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('requested','processed','failed')", name='ck_refunds_status'),
    sa.ForeignKeyConstraint(['payment_id'], ['kv_commerce.payments.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('idempotency_key', name='uq_refunds_idem'),
    schema='kv_commerce'
    )
    op.create_index(op.f('ix_kv_commerce_refunds_tenant_id'), 'refunds', ['tenant_id'], unique=False, schema='kv_commerce')
    op.add_column('videos', sa.Column('access', sa.String(length=8), server_default='free', nullable=False), schema='kv_media')
    op.add_column('videos', sa.Column('price_inr_minor', sa.Integer(), nullable=True), schema='kv_media')
    op.add_column('videos', sa.Column('members_rank', sa.SmallInteger(), nullable=True), schema='kv_media')
    op.add_column('videos', sa.Column('preview_seconds', sa.Integer(), server_default='60', nullable=False), schema='kv_media')
    op.add_column('comments', sa.Column('paid_minor', sa.Integer(), server_default='0', nullable=False), schema='kv_social')
    op.add_column('comments', sa.Column('checkout_id', sa.BigInteger(), nullable=True), schema='kv_social')
    op.add_column('danmaku', sa.Column('paid_minor', sa.Integer(), server_default='0', nullable=False), schema='kv_social')
    op.add_column('danmaku', sa.Column('boost_tier', sa.SmallInteger(), nullable=True), schema='kv_social')
    op.add_column('danmaku', sa.Column('pin_ms', sa.Integer(), server_default='0', nullable=False), schema='kv_social')
    op.add_column('danmaku', sa.Column('checkout_id', sa.BigInteger(), nullable=True), schema='kv_social')
    op.add_column('playlists', sa.Column('price_inr_minor', sa.Integer(), nullable=True), schema='kv_social')

    op.drop_constraint("ck_checkouts_purpose", "checkouts", schema="kv_commerce", type_="check")
    op.create_check_constraint("ck_checkouts_purpose", "checkouts",
                               "purpose IN ('plan','tip','boost','membership','video','series')", schema="kv_commerce")
    op.create_check_constraint("ck_videos_access", "videos", "access IN ('free','members','paid')", schema="kv_media")
    op.create_check_constraint("ck_videos_paid_price", "videos", "access <> 'paid' OR price_inr_minor > 0", schema="kv_media")
    for table in TABLES:
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO klygenix_video_app")
        op.execute(f"GRANT USAGE, SELECT ON SEQUENCE {table}_id_seq TO klygenix_video_app")
    op.execute("SELECT kv_admin.apply_tenancy()")
    op.execute("INSERT INTO kv_tax.tax_codes (code, name, sac) VALUES ('PLATFORM', 'Platform services to creators (commission)', '998599') ON CONFLICT (code) DO NOTHING")
    op.execute("INSERT INTO kv_tax.tax_rates (tax_code_id, rate_bps, effective_from, source) SELECT id, 1800, DATE '2017-07-01', "
               "'Believed current Nov 2026 — confirm with CA before launch' FROM kv_tax.tax_codes WHERE code = 'PLATFORM' ON CONFLICT DO NOTHING")
    for section, bps, threshold, start, source in WITHHOLDING:
        op.execute("INSERT INTO kv_tax.withholding_rates (section, rate_bps, threshold_minor, effective_from, source) "
                   f"VALUES ('{section}', {bps}, {threshold}, DATE '{start}', '{source}') ON CONFLICT DO NOTHING")
    for key, bps in COMMISSION.items():
        op.execute(f"UPDATE kv_commerce.plans SET limits = limits || '{json.dumps({'commission_bps': bps})}'::jsonb WHERE key = '{key}'")


def downgrade() -> None:
    for key in COMMISSION:
        op.execute(f"UPDATE kv_commerce.plans SET limits = limits - 'commission_bps' WHERE key = '{key}'")
    op.execute("DELETE FROM kv_tax.withholding_rates WHERE section IN ('TCS52','194O','194O_NOPAN')")
    op.execute("DELETE FROM kv_tax.tax_rates WHERE tax_code_id IN (SELECT id FROM kv_tax.tax_codes WHERE code = 'PLATFORM')")
    op.execute("DELETE FROM kv_tax.tax_codes WHERE code = 'PLATFORM'")
    op.drop_constraint("ck_videos_paid_price", "videos", schema="kv_media", type_="check")
    op.drop_constraint("ck_videos_access", "videos", schema="kv_media", type_="check")
    op.drop_constraint("ck_checkouts_purpose", "checkouts", schema="kv_commerce", type_="check")
    op.execute("DELETE FROM kv_commerce.checkouts WHERE purpose NOT IN ('plan','tip','membership')")
    op.create_check_constraint("ck_checkouts_purpose", "checkouts", "purpose IN ('plan','tip','membership')", schema="kv_commerce")
    op.drop_column('playlists', 'price_inr_minor', schema='kv_social')
    op.drop_column('danmaku', 'checkout_id', schema='kv_social')
    op.drop_column('danmaku', 'pin_ms', schema='kv_social')
    op.drop_column('danmaku', 'boost_tier', schema='kv_social')
    op.drop_column('danmaku', 'paid_minor', schema='kv_social')
    op.drop_column('comments', 'checkout_id', schema='kv_social')
    op.drop_column('comments', 'paid_minor', schema='kv_social')
    op.drop_column('videos', 'preview_seconds', schema='kv_media')
    op.drop_column('videos', 'members_rank', schema='kv_media')
    op.drop_column('videos', 'price_inr_minor', schema='kv_media')
    op.drop_column('videos', 'access', schema='kv_media')
    op.drop_index(op.f('ix_kv_commerce_refunds_tenant_id'), table_name='refunds', schema='kv_commerce')
    op.drop_table('refunds', schema='kv_commerce')
    op.drop_index('uq_route_transfers_split_kind', table_name='route_transfers', schema='kv_commerce', postgresql_where="kind IN ('sale','reserve')")
    op.drop_index('ix_route_transfers_release', table_name='route_transfers', schema='kv_commerce')
    op.drop_index(op.f('ix_kv_commerce_route_transfers_tenant_id'), table_name='route_transfers', schema='kv_commerce')
    op.drop_table('route_transfers', schema='kv_commerce')
    op.drop_index(op.f('ix_kv_commerce_membership_tiers_tenant_id'), table_name='membership_tiers', schema='kv_commerce')
    op.drop_table('membership_tiers', schema='kv_commerce')
    op.drop_index(op.f('ix_kv_commerce_payout_accounts_tenant_id'), table_name='payout_accounts', schema='kv_commerce')
    op.drop_table('payout_accounts', schema='kv_commerce')
    op.drop_index(op.f('ix_kv_commerce_creator_splits_tenant_id'), table_name='creator_splits', schema='kv_commerce')
    op.drop_index('ix_creator_splits_tenant_paid', table_name='creator_splits', schema='kv_commerce')
    op.drop_table('creator_splits', schema='kv_commerce')

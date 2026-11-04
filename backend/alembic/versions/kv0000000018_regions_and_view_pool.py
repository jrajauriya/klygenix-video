"""regions and view pool

Revision ID: kv0000000018
Revises: kv0000000017
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'kv0000000018'
down_revision: Union[str, None] = 'kv0000000017'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('home_region', sa.String(length=4), server_default='in', nullable=False), schema='kv_admin')
    op.add_column('ad_payouts', sa.Column('kind', sa.String(length=10), server_default='ad_share', nullable=False), schema='kv_commerce')
    op.add_column('ad_payouts', sa.Column('watch_ms', sa.BigInteger(), server_default='0', nullable=False), schema='kv_commerce')
    op.drop_constraint(op.f('uq_ad_payouts_period'), 'ad_payouts', schema='kv_commerce', type_='unique')
    op.create_unique_constraint('uq_ad_payouts_period', 'ad_payouts', ['tenant_id', 'period', 'kind'], schema='kv_commerce')
    op.alter_column("route_transfers", "kind", existing_type=sa.String(length=8), type_=sa.String(length=10),
                    existing_nullable=False, schema="kv_commerce")
    op.create_check_constraint("ck_ad_payouts_kind", "ad_payouts", "kind IN ('ad_share','view_pool')", schema="kv_commerce")
    op.drop_constraint("ck_route_transfers_kind", "route_transfers", schema="kv_commerce", type_="check")
    op.create_check_constraint("ck_route_transfers_kind", "route_transfers",
                               "kind IN ('sale','reserve','recovery','ad_share','view_pool')", schema="kv_commerce")
    op.execute("UPDATE kv_admin.users SET home_region = 'us' WHERE tenant_id IN (SELECT p.tenant_id FROM kv_social.profiles p "
               "WHERE p.country IN ('US','CA'))")


def downgrade() -> None:
    op.execute("DELETE FROM kv_commerce.route_transfers WHERE kind = 'view_pool'")
    op.execute("DELETE FROM kv_commerce.ad_payouts WHERE kind = 'view_pool'")
    op.drop_constraint("ck_route_transfers_kind", "route_transfers", schema="kv_commerce", type_="check")
    op.create_check_constraint("ck_route_transfers_kind", "route_transfers", "kind IN ('sale','reserve','recovery','ad_share')",
                               schema="kv_commerce")
    op.drop_constraint("ck_ad_payouts_kind", "ad_payouts", schema="kv_commerce", type_="check")
    op.alter_column("route_transfers", "kind", existing_type=sa.String(length=10), type_=sa.String(length=8),
                    existing_nullable=False, schema="kv_commerce")
    op.drop_constraint('uq_ad_payouts_period', 'ad_payouts', schema='kv_commerce', type_='unique')
    op.create_unique_constraint(op.f('uq_ad_payouts_period'), 'ad_payouts', ['tenant_id', 'period'], schema='kv_commerce', postgresql_nulls_not_distinct=False)
    op.drop_column('ad_payouts', 'watch_ms', schema='kv_commerce')
    op.drop_column('ad_payouts', 'kind', schema='kv_commerce')
    op.drop_column('users', 'home_region', schema='kv_admin')

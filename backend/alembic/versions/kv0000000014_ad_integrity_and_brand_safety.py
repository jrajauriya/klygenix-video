"""ad integrity and brand safety

Revision ID: kv0000000014
Revises: kv0000000013
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'kv0000000014'
down_revision: Union[str, None] = 'kv0000000013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('ad_campaigns', sa.Column('exclude_categories', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False), schema='kv_commerce')
    op.add_column('ad_daily', sa.Column('device', sa.String(length=8), server_default='desktop', nullable=False), schema='kv_commerce')
    op.add_column('ad_daily', sa.Column('starts', sa.BigInteger(), server_default='0', nullable=False), schema='kv_commerce')
    op.add_column('ad_daily', sa.Column('invalid', sa.BigInteger(), server_default='0', nullable=False), schema='kv_commerce')
    op.drop_constraint(op.f('uq_ad_daily'), 'ad_daily', schema='kv_commerce', type_='unique')
    op.create_unique_constraint('uq_ad_daily', 'ad_daily', ['campaign_id', 'video_id', 'day', 'device'], schema='kv_commerce')
    op.add_column('videos', sa.Column('made_for_kids', sa.Boolean(), server_default='false', nullable=False), schema='kv_media')
    op.add_column('videos', sa.Column('safety_labels', postgresql.JSONB(astext_type=sa.Text()), nullable=True), schema='kv_media')


def downgrade() -> None:
    op.drop_column('videos', 'safety_labels', schema='kv_media')
    op.drop_column('videos', 'made_for_kids', schema='kv_media')
    op.drop_constraint('uq_ad_daily', 'ad_daily', schema='kv_commerce', type_='unique')
    op.create_unique_constraint(op.f('uq_ad_daily'), 'ad_daily', ['campaign_id', 'video_id', 'day'], schema='kv_commerce', postgresql_nulls_not_distinct=False)
    op.drop_column('ad_daily', 'invalid', schema='kv_commerce')
    op.drop_column('ad_daily', 'starts', schema='kv_commerce')
    op.drop_column('ad_daily', 'device', schema='kv_commerce')
    op.drop_column('ad_campaigns', 'exclude_categories', schema='kv_commerce')

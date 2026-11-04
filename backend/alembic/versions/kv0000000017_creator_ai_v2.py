"""creator ai v2

Revision ID: kv0000000017
Revises: kv0000000016
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'kv0000000017'
down_revision: Union[str, None] = 'kv0000000016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('repurpose_packs',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('video_id', sa.BigInteger(), nullable=False),
    sa.Column('language', sa.String(length=8), nullable=False),
    sa.Column('content', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('model', sa.String(length=60), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['video_id'], ['kv_media.videos.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_ai'
    )
    op.create_index('idx_repurpose_video', 'repurpose_packs', ['video_id', 'created_at'], unique=False, schema='kv_ai')
    op.create_index(op.f('ix_kv_ai_repurpose_packs_tenant_id'), 'repurpose_packs', ['tenant_id'], unique=False, schema='kv_ai')
    op.add_column('videos', sa.Column('thumbnail_ai', sa.Boolean(), server_default='false', nullable=False), schema='kv_media')
    op.add_column('publish_targets', sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=True), schema='kv_studio')
    op.drop_constraint("ck_publish_targets_status", "publish_targets", schema="kv_studio", type_="check")
    op.create_check_constraint("ck_publish_targets_status", "publish_targets", "status IN ('scheduled','queued','publishing','published','failed','cancelled')", schema="kv_studio")
    for key, n in (("creator_free", 10), ("creator_pro", 200), ("creator_business", 1000)):
        op.execute(f"UPDATE kv_commerce.plans SET limits = limits || '{{\"ai_images\": {n}}}'::jsonb WHERE key = '{key}'")
    op.execute("SELECT kv_admin.apply_tenancy()")


def downgrade() -> None:
    op.execute("UPDATE kv_studio.publish_targets SET status = 'failed' WHERE status IN ('scheduled','cancelled')")
    op.drop_constraint("ck_publish_targets_status", "publish_targets", schema="kv_studio", type_="check")
    op.create_check_constraint("ck_publish_targets_status", "publish_targets", "status IN ('queued','publishing','published','failed')", schema="kv_studio")
    op.execute("UPDATE kv_commerce.plans SET limits = limits - 'ai_images'")
    op.drop_column('publish_targets', 'scheduled_at', schema='kv_studio')
    op.drop_column('videos', 'thumbnail_ai', schema='kv_media')
    op.drop_index(op.f('ix_kv_ai_repurpose_packs_tenant_id'), table_name='repurpose_packs', schema='kv_ai')
    op.drop_index('idx_repurpose_video', table_name='repurpose_packs', schema='kv_ai')
    op.drop_table('repurpose_packs', schema='kv_ai')

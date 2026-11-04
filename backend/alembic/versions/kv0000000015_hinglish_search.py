"""hinglish search

Revision ID: kv0000000015
Revises: kv0000000014
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'kv0000000015'
down_revision: Union[str, None] = 'kv0000000014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.add_column('segments', sa.Column('roman', sa.Text(), server_default='', nullable=False), schema='kv_ai')
    op.add_column('segments', sa.Column('search_roman', postgresql.TSVECTOR(), sa.Computed("to_tsvector('simple', roman)", persisted=True), nullable=True), schema='kv_ai')
    op.create_index('idx_segments_search_roman', 'segments', ['search_roman'], unique=False, schema='kv_ai', postgresql_using='gin')
    op.add_column('videos', sa.Column('roman', sa.Text(), server_default='', nullable=False), schema='kv_media')
    op.add_column('videos', sa.Column('search_roman', postgresql.TSVECTOR(), sa.Computed("to_tsvector('simple', roman)", persisted=True), nullable=True), schema='kv_media')
    op.create_index('idx_videos_roman_trgm', 'videos', ['roman'], unique=False, schema='kv_media', postgresql_using='gin', postgresql_ops={'roman': 'gin_trgm_ops'})
    op.create_index('idx_videos_search_roman', 'videos', ['search_roman'], unique=False, schema='kv_media', postgresql_using='gin')
    from app.video.services.translit import roman

    bind = op.get_bind()
    videos = bind.execute(sa.text("SELECT id, title, description, tags FROM kv_media.videos")).all()
    if videos:
        bind.execute(sa.text("UPDATE kv_media.videos SET roman = :r WHERE id = :i"),
                     [{"i": v[0], "r": roman(" ".join([v[1] or "", v[2] or "", " ".join(v[3] or [])]))} for v in videos])
    segments = bind.execute(sa.text("SELECT id, text FROM kv_ai.segments")).all()
    if segments:
        bind.execute(sa.text("UPDATE kv_ai.segments SET roman = :r WHERE id = :i"), [{"i": s_[0], "r": roman(s_[1])} for s_ in segments])


def downgrade() -> None:
    op.drop_index('idx_videos_search_roman', table_name='videos', schema='kv_media', postgresql_using='gin')
    op.drop_index('idx_videos_roman_trgm', table_name='videos', schema='kv_media', postgresql_using='gin', postgresql_ops={'roman': 'gin_trgm_ops'})
    op.drop_column('videos', 'search_roman', schema='kv_media')
    op.drop_column('videos', 'roman', schema='kv_media')
    op.drop_index('idx_segments_search_roman', table_name='segments', schema='kv_ai', postgresql_using='gin')
    op.drop_column('segments', 'search_roman', schema='kv_ai')
    op.drop_column('segments', 'roman', schema='kv_ai')

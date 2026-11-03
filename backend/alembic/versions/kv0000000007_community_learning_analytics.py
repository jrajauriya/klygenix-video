"""community, learning and analytics — posts, polls, moderators, notes, quizzes, study sets, translations,
video vectors, product links, music, publish targets, dubbing, Ask across a channel or series, traffic sources

Revision ID: kv0000000007
Revises: kv0000000006
"""
from typing import Sequence, Union

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'kv0000000007'
down_revision: Union[str, None] = 'kv0000000006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TENANT_TABLES = ['kv_social.channel_moderators', 'kv_social.posts', 'kv_ai.study_sets', 'kv_media.dub_tracks', 'kv_media.product_links', 'kv_social.notes', 'kv_social.poll_options', 'kv_social.quiz_attempts', 'kv_social.poll_votes', 'kv_studio.publish_targets']
PUBLIC_READ = {
    "kv_media.product_links": "kv_media.video_readable(video_id)",
    "kv_ai.study_sets": "kv_media.video_readable(video_id)",
    "kv_media.dub_tracks": "kv_media.video_readable(video_id)",
    "kv_social.posts": "status = 'visible'",
    "kv_social.poll_options": "true",
}
SHARED_TABLES = ['kv_ai.text_translations', 'kv_studio.music_tracks']


def upgrade() -> None:
    op.create_table('text_translations',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('digest', sa.String(length=64), nullable=False),
    sa.Column('language', sa.String(length=8), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('model', sa.String(length=60), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('digest', 'language', name='uq_text_translations'),
    schema='kv_ai'
    )
    op.create_table('music_tracks',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('artist', sa.String(length=120), nullable=False),
    sa.Column('mood', sa.String(length=30), server_default='', nullable=False),
    sa.Column('duration_ms', sa.Integer(), nullable=False),
    sa.Column('licence', sa.String(length=120), nullable=False),
    sa.Column('licence_url', sa.String(length=300), server_default='', nullable=False),
    sa.Column('storage_key', sa.String(length=300), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_studio'
    )
    op.create_table('channel_moderators',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('channel_id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('added_by', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['channel_id'], ['kv_social.channels.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('channel_id', 'user_id', name='uq_channel_moderators'),
    schema='kv_social'
    )
    op.create_index(op.f('ix_kv_social_channel_moderators_tenant_id'), 'channel_moderators', ['tenant_id'], unique=False, schema='kv_social')
    op.create_index(op.f('ix_kv_social_channel_moderators_user_id'), 'channel_moderators', ['user_id'], unique=False, schema='kv_social')
    op.create_table('posts',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('channel_id', sa.BigInteger(), nullable=False),
    sa.Column('author_user_id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=6), nullable=False),
    sa.Column('body', sa.Text(), server_default='', nullable=False),
    sa.Column('image_key', sa.String(length=300), nullable=True),
    sa.Column('members_rank', sa.SmallInteger(), nullable=True),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('text','image','poll')", name='ck_posts_kind'),
    sa.CheckConstraint("status IN ('visible','hidden','deleted')", name='ck_posts_status'),
    sa.ForeignKeyConstraint(['channel_id'], ['kv_social.channels.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_social'
    )
    op.create_index('idx_posts_channel', 'posts', ['channel_id', 'created_at'], unique=False, schema='kv_social')
    op.create_index(op.f('ix_kv_social_posts_tenant_id'), 'posts', ['tenant_id'], unique=False, schema='kv_social')
    op.create_table('study_sets',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('video_id', sa.BigInteger(), nullable=False),
    sa.Column('language', sa.String(length=8), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('items', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('model', sa.String(length=60), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('notes','quiz','flashcards')", name='ck_study_sets_kind'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['video_id'], ['kv_media.videos.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('video_id', 'language', 'kind', name='uq_study_sets'),
    schema='kv_ai'
    )
    op.create_index(op.f('ix_kv_ai_study_sets_tenant_id'), 'study_sets', ['tenant_id'], unique=False, schema='kv_ai')
    op.create_table('video_vectors',
    sa.Column('video_id', sa.BigInteger(), nullable=False),
    sa.Column('embedding', pgvector.sqlalchemy.vector.VECTOR(dim=1536), nullable=False),
    sa.Column('model', sa.String(length=60), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['video_id'], ['kv_media.videos.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('video_id'),
    schema='kv_ai'
    )
    op.create_table('dub_tracks',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('video_id', sa.BigInteger(), nullable=False),
    sa.Column('language', sa.String(length=8), nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('voice', sa.String(length=60), server_default='', nullable=False),
    sa.Column('model', sa.String(length=60), server_default='', nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('queued','ready','failed')", name='ck_dub_tracks_status'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['video_id'], ['kv_media.videos.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('video_id', 'language', name='uq_dub_tracks'),
    schema='kv_media'
    )
    op.create_index(op.f('ix_kv_media_dub_tracks_tenant_id'), 'dub_tracks', ['tenant_id'], unique=False, schema='kv_media')
    op.create_table('product_links',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('video_id', sa.BigInteger(), nullable=False),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('url', sa.String(length=500), nullable=False),
    sa.Column('price_text', sa.String(length=40), server_default='', nullable=False),
    sa.Column('position', sa.SmallInteger(), nullable=False),
    sa.Column('clicks', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['video_id'], ['kv_media.videos.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_media'
    )
    op.create_index('idx_product_links_video', 'product_links', ['video_id', 'position'], unique=False, schema='kv_media')
    op.create_index(op.f('ix_kv_media_product_links_tenant_id'), 'product_links', ['tenant_id'], unique=False, schema='kv_media')
    op.create_table('notes',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('video_id', sa.BigInteger(), nullable=False),
    sa.Column('t_ms', sa.BigInteger(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['video_id'], ['kv_media.videos.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_social'
    )
    op.create_index('idx_notes_user_video', 'notes', ['user_id', 'video_id', 't_ms'], unique=False, schema='kv_social')
    op.create_index(op.f('ix_kv_social_notes_tenant_id'), 'notes', ['tenant_id'], unique=False, schema='kv_social')
    op.create_table('poll_options',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('post_id', sa.BigInteger(), nullable=False),
    sa.Column('position', sa.SmallInteger(), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=False),
    sa.ForeignKeyConstraint(['post_id'], ['kv_social.posts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_social'
    )
    op.create_index(op.f('ix_kv_social_poll_options_post_id'), 'poll_options', ['post_id'], unique=False, schema='kv_social')
    op.create_index(op.f('ix_kv_social_poll_options_tenant_id'), 'poll_options', ['tenant_id'], unique=False, schema='kv_social')
    op.create_table('quiz_attempts',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('video_id', sa.BigInteger(), nullable=False),
    sa.Column('study_set_id', sa.BigInteger(), nullable=False),
    sa.Column('score', sa.Integer(), nullable=False),
    sa.Column('total', sa.Integer(), nullable=False),
    sa.Column('answers', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['video_id'], ['kv_media.videos.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_social'
    )
    op.create_index('idx_quiz_attempts_user', 'quiz_attempts', ['user_id', 'video_id'], unique=False, schema='kv_social')
    op.create_index(op.f('ix_kv_social_quiz_attempts_tenant_id'), 'quiz_attempts', ['tenant_id'], unique=False, schema='kv_social')
    op.create_table('poll_votes',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('post_id', sa.BigInteger(), nullable=False),
    sa.Column('option_id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['option_id'], ['kv_social.poll_options.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['post_id'], ['kv_social.posts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('post_id', 'user_id', name='uq_poll_votes'),
    schema='kv_social'
    )
    op.create_index(op.f('ix_kv_social_poll_votes_tenant_id'), 'poll_votes', ['tenant_id'], unique=False, schema='kv_social')
    op.create_table('publish_targets',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('clip_id', sa.BigInteger(), nullable=False),
    sa.Column('platform', sa.String(length=10), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('caption', sa.Text(), server_default='', nullable=False),
    sa.Column('external_id', sa.String(length=80), nullable=True),
    sa.Column('external_url', sa.String(length=300), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("platform IN ('youtube','instagram')", name='ck_publish_targets_platform'),
    sa.CheckConstraint("status IN ('queued','publishing','published','failed')", name='ck_publish_targets_status'),
    sa.ForeignKeyConstraint(['clip_id'], ['kv_studio.clips.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('clip_id', 'platform', name='uq_publish_targets'),
    schema='kv_studio'
    )
    op.create_index(op.f('ix_kv_studio_publish_targets_tenant_id'), 'publish_targets', ['tenant_id'], unique=False, schema='kv_studio')
    op.add_column('ask_messages', sa.Column('scope', sa.String(length=8), server_default='video', nullable=False), schema='kv_ai')
    op.add_column('ask_messages', sa.Column('scope_id', sa.BigInteger(), nullable=True), schema='kv_ai')
    op.alter_column('ask_messages', 'video_id',
               existing_type=sa.BIGINT(),
               nullable=True,
               schema='kv_ai')
    op.add_column('videos', sa.Column('dubbing_allowed', sa.Boolean(), server_default='false', nullable=False), schema='kv_media')
    op.add_column('view_daily', sa.Column('sources', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False), schema='kv_social')
    op.add_column('clips', sa.Column('music', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False), schema='kv_studio')

    op.create_check_constraint("ck_ask_messages_scope", "ask_messages", "scope IN ('video','channel','series')", schema="kv_ai")
    for table in TENANT_TABLES + SHARED_TABLES:
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO klygenix_video_app")
        op.execute(f"GRANT USAGE, SELECT ON SEQUENCE {table}_id_seq TO klygenix_video_app")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON kv_ai.video_vectors TO klygenix_video_app")
    op.execute("SELECT kv_admin.apply_tenancy()")
    for table, predicate in PUBLIC_READ.items():
        op.execute(f"DROP POLICY IF EXISTS public_read ON {table}")
        op.execute(f"CREATE POLICY public_read ON {table} FOR SELECT USING ({predicate})")


def downgrade() -> None:
    op.drop_constraint("ck_ask_messages_scope", "ask_messages", schema="kv_ai", type_="check")
    op.drop_column('clips', 'music', schema='kv_studio')
    op.drop_column('view_daily', 'sources', schema='kv_social')
    op.drop_column('videos', 'dubbing_allowed', schema='kv_media')
    op.alter_column('ask_messages', 'video_id',
               existing_type=sa.BIGINT(),
               nullable=False,
               schema='kv_ai')
    op.drop_column('ask_messages', 'scope_id', schema='kv_ai')
    op.drop_column('ask_messages', 'scope', schema='kv_ai')
    op.drop_index(op.f('ix_kv_studio_publish_targets_tenant_id'), table_name='publish_targets', schema='kv_studio')
    op.drop_table('publish_targets', schema='kv_studio')
    op.drop_index(op.f('ix_kv_social_poll_votes_tenant_id'), table_name='poll_votes', schema='kv_social')
    op.drop_table('poll_votes', schema='kv_social')
    op.drop_index(op.f('ix_kv_social_quiz_attempts_tenant_id'), table_name='quiz_attempts', schema='kv_social')
    op.drop_index('idx_quiz_attempts_user', table_name='quiz_attempts', schema='kv_social')
    op.drop_table('quiz_attempts', schema='kv_social')
    op.drop_index(op.f('ix_kv_social_poll_options_tenant_id'), table_name='poll_options', schema='kv_social')
    op.drop_index(op.f('ix_kv_social_poll_options_post_id'), table_name='poll_options', schema='kv_social')
    op.drop_table('poll_options', schema='kv_social')
    op.drop_index(op.f('ix_kv_social_notes_tenant_id'), table_name='notes', schema='kv_social')
    op.drop_index('idx_notes_user_video', table_name='notes', schema='kv_social')
    op.drop_table('notes', schema='kv_social')
    op.drop_index(op.f('ix_kv_media_product_links_tenant_id'), table_name='product_links', schema='kv_media')
    op.drop_index('idx_product_links_video', table_name='product_links', schema='kv_media')
    op.drop_table('product_links', schema='kv_media')
    op.drop_index(op.f('ix_kv_media_dub_tracks_tenant_id'), table_name='dub_tracks', schema='kv_media')
    op.drop_table('dub_tracks', schema='kv_media')
    op.drop_table('video_vectors', schema='kv_ai')
    op.drop_index(op.f('ix_kv_ai_study_sets_tenant_id'), table_name='study_sets', schema='kv_ai')
    op.drop_table('study_sets', schema='kv_ai')
    op.drop_index(op.f('ix_kv_social_posts_tenant_id'), table_name='posts', schema='kv_social')
    op.drop_index('idx_posts_channel', table_name='posts', schema='kv_social')
    op.drop_table('posts', schema='kv_social')
    op.drop_index(op.f('ix_kv_social_channel_moderators_user_id'), table_name='channel_moderators', schema='kv_social')
    op.drop_index(op.f('ix_kv_social_channel_moderators_tenant_id'), table_name='channel_moderators', schema='kv_social')
    op.drop_table('channel_moderators', schema='kv_social')
    op.drop_table('music_tracks', schema='kv_studio')
    op.drop_table('text_translations', schema='kv_ai')

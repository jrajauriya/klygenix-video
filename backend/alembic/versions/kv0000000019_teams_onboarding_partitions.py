"""teams, onboarding, support and partitions

Revision ID: kv0000000019
Revises: kv0000000018
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'kv0000000019'
down_revision: Union[str, None] = 'kv0000000018'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PARTITIONED = (
    ("kv_ai", "reco_impressions", "shown_at",
     """id bigint NOT NULL DEFAULT nextval('kv_ai.reco_impressions_id_seq'::regclass), user_id integer NOT NULL,
        video_id bigint NOT NULL, "position" integer NOT NULL, surface character varying(8) NOT NULL,
        arm character varying(10) NOT NULL, shown_at timestamp with time zone NOT NULL,
        clicked_at timestamp with time zone, labelled boolean DEFAULT false NOT NULL""",
     "id, user_id, video_id, \"position\", surface, arm, shown_at, clicked_at, labelled",
     (("idx_reco_impressions_user", "user_id, shown_at"), ("idx_reco_impressions_shown", "shown_at")), ()),
    ("kv_admin", "activity_log", "occurred_at",
     """id bigint NOT NULL DEFAULT nextval('kv_admin.activity_log_id_seq'::regclass), tenant_id integer, user_id integer,
        occurred_at timestamp without time zone NOT NULL, app character varying(10) NOT NULL, kind character varying(10) NOT NULL,
        label character varying(200) NOT NULL, method character varying(10) NOT NULL, path character varying(300) NOT NULL,
        entity_id character varying(50), status_code smallint NOT NULL, duration_ms integer, ip character varying(45),
        user_agent character varying(300)""",
     "id, tenant_id, user_id, occurred_at, app, kind, label, method, path, entity_id, status_code, duration_ms, ip, user_agent",
     (("idx_activity_log_tenant_time", "tenant_id, occurred_at"), ("idx_activity_log_user_time", "user_id, occurred_at"),
      ("ix_kv_admin_activity_log_tenant_id", "tenant_id")),
     (("activity_log_tenant_id_fkey", "FOREIGN KEY (tenant_id) REFERENCES kv_admin.tenants(id) ON DELETE CASCADE"),
      ("activity_log_user_id_fkey", "FOREIGN KEY (user_id) REFERENCES kv_admin.users(id)"))),
)


def _partition(schema, table, column, cols, names, indexes, fks) -> None:
    old = f"{table}_unpartitioned"
    op.execute(f"ALTER TABLE {schema}.{table} RENAME TO {old}")
    op.execute(f"ALTER SEQUENCE {schema}.{table}_id_seq OWNED BY NONE")
    op.execute(f"ALTER TABLE {schema}.{old} ALTER COLUMN id DROP DEFAULT")
    for name, _ in indexes:
        op.execute(f"DROP INDEX IF EXISTS {schema}.{name}")
    for name, _ in fks:
        op.execute(f"ALTER TABLE {schema}.{old} DROP CONSTRAINT IF EXISTS {name}")
    op.execute(f"ALTER TABLE {schema}.{old} DROP CONSTRAINT IF EXISTS {table}_pkey")
    op.execute(f"CREATE TABLE {schema}.{table} ({cols}, CONSTRAINT {table}_pkey PRIMARY KEY (id, {column})) "
               f"PARTITION BY RANGE ({column})")
    op.execute(f"CREATE TABLE {schema}.{table}_default PARTITION OF {schema}.{table} DEFAULT")
    for name, fk in fks:
        op.execute(f"ALTER TABLE {schema}.{table} ADD CONSTRAINT {name} {fk}")
    for name, on in indexes:
        op.execute(f"CREATE INDEX {name} ON {schema}.{table} ({on})")
    op.execute(f"INSERT INTO {schema}.{table} ({names}) SELECT {names} FROM {schema}.{old}")
    op.execute(f"DROP TABLE {schema}.{old}")
    op.execute(f"ALTER SEQUENCE {schema}.{table}_id_seq OWNED BY {schema}.{table}.id")


def _unpartition(schema, table, column, cols, names, indexes, fks) -> None:
    old = f"{table}_partitioned"
    op.execute(f"ALTER TABLE {schema}.{table} RENAME TO {old}")
    op.execute(f"ALTER SEQUENCE {schema}.{table}_id_seq OWNED BY NONE")
    for name, _ in indexes:
        op.execute(f"DROP INDEX IF EXISTS {schema}.{name}")
    for name, _ in fks:
        op.execute(f"ALTER TABLE {schema}.{old} DROP CONSTRAINT IF EXISTS {name}")
    op.execute(f"ALTER TABLE {schema}.{old} DROP CONSTRAINT IF EXISTS {table}_pkey")
    op.execute(f"CREATE TABLE {schema}.{table} ({cols}, CONSTRAINT {table}_pkey PRIMARY KEY (id))")
    for name, fk in fks:
        op.execute(f"ALTER TABLE {schema}.{table} ADD CONSTRAINT {name} {fk}")
    for name, on in indexes:
        op.execute(f"CREATE INDEX {name} ON {schema}.{table} ({on})")
    op.execute(f"INSERT INTO {schema}.{table} ({names}) SELECT {names} FROM {schema}.{old}")
    op.execute(f"DROP TABLE {schema}.{old} CASCADE")
    op.execute(f"ALTER SEQUENCE {schema}.{table}_id_seq OWNED BY {schema}.{table}.id")


MAINTAIN = """
CREATE OR REPLACE FUNCTION kv_admin.maintain_partitions(p_schema text, p_table text, p_column text, p_ahead int, p_keep_days int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
    v_today date := (now() AT TIME ZONE 'UTC')::date;
    v_oldest timestamp;
    v_month date;
    v_next date;
    v_name text;
    v_n bigint;
    v_moved bigint := 0;
    v_keep date;
    v_created text[] := '{}';
    v_dropped text[] := '{}';
    r record;
BEGIN
    IF (p_schema, p_table, p_column) NOT IN (('kv_ai', 'reco_impressions', 'shown_at'), ('kv_admin', 'activity_log', 'occurred_at')) THEN
        RAISE EXCEPTION 'not a partitioned table: %.%', p_schema, p_table;
    END IF;
    EXECUTE format('SELECT min(%I)::timestamp FROM %I.%I', p_column, p_schema, p_table || '_default') INTO v_oldest;
    v_month := date_trunc('month', LEAST(COALESCE(v_oldest::date, v_today), v_today))::date;
    WHILE v_month <= (date_trunc('month', v_today) + make_interval(months => p_ahead))::date LOOP
        v_next := (v_month + interval '1 month')::date;
        v_name := p_table || '_p' || to_char(v_month, 'YYYYMM');
        IF to_regclass(format('%I.%I', p_schema, v_name)) IS NULL THEN
            EXECUTE format('CREATE TABLE %I.%I (LIKE %I.%I INCLUDING DEFAULTS)', p_schema, v_name, p_schema, p_table);
            EXECUTE format('WITH m AS (DELETE FROM %I.%I WHERE %I >= %L AND %I < %L RETURNING *) INSERT INTO %I.%I SELECT * FROM m',
                           p_schema, p_table || '_default', p_column, v_month, p_column, v_next, p_schema, v_name);
            GET DIAGNOSTICS v_n = ROW_COUNT;
            v_moved := v_moved + v_n;
            EXECUTE format('ALTER TABLE %I.%I ATTACH PARTITION %I.%I FOR VALUES FROM (%L) TO (%L)',
                           p_schema, p_table, p_schema, v_name, v_month, v_next);
            v_created := v_created || (p_schema || '.' || v_name);
        END IF;
        v_month := v_next;
    END LOOP;
    v_keep := date_trunc('month', v_today - p_keep_days)::date;
    FOR r IN SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
             JOIN pg_namespace n ON n.oid = p.relnamespace
             WHERE n.nspname = p_schema AND p.relname = p_table AND c.relname ~ ('^' || p_table || '_p[0-9]{6}$') LOOP
        IF (to_date(right(r.relname, 6), 'YYYYMM') + interval '1 month')::date <= v_keep THEN
            EXECUTE format('DROP TABLE %I.%I', p_schema, r.relname);
            v_dropped := v_dropped || (p_schema || '.' || r.relname);
        END IF;
    END LOOP;
    RETURN jsonb_build_object('created', to_jsonb(v_created), 'dropped', to_jsonb(v_dropped), 'moved', v_moved);
END
$fn$;
"""


def upgrade() -> None:
    op.create_table('tenant_members',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('email', sa.String(length=200), nullable=False),
    sa.Column('role', sa.String(length=12), nullable=False),
    sa.Column('status', sa.String(length=10), server_default='invited', nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=True),
    sa.Column('invited_by', sa.Integer(), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('removed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("role IN ('manager','editor','moderator','analyst')", name='ck_tenant_members_role'),
    sa.CheckConstraint("status IN ('invited','active','removed')", name='ck_tenant_members_status'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['kv_admin.users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_admin'
    )
    op.create_index('idx_tenant_members_user', 'tenant_members', ['user_id', 'status'], unique=False, schema='kv_admin')
    op.create_index(op.f('ix_kv_admin_tenant_members_tenant_id'), 'tenant_members', ['tenant_id'], unique=False, schema='kv_admin')
    op.create_index('uq_tenant_members_open', 'tenant_members', ['tenant_id', 'email'], unique=True, schema='kv_admin',
                    postgresql_where="status <> 'removed'")
    op.create_table('import_jobs',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('connected_id', sa.BigInteger(), nullable=False),
    sa.Column('status', sa.String(length=8), server_default='queued', nullable=False),
    sa.Column('total', sa.Integer(), server_default='0', nullable=False),
    sa.Column('done', sa.Integer(), server_default='0', nullable=False),
    sa.Column('failed', sa.Integer(), server_default='0', nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("status IN ('queued','running','done','failed')", name='ck_import_jobs_status'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    schema='kv_media'
    )
    op.create_index(op.f('ix_kv_media_import_jobs_tenant_id'), 'import_jobs', ['tenant_id'], unique=False, schema='kv_media')
    op.create_table('import_items',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('job_id', sa.BigInteger(), nullable=False),
    sa.Column('external_id', sa.String(length=40), nullable=False),
    sa.Column('title', sa.String(length=200), server_default='', nullable=False),
    sa.Column('status', sa.String(length=8), server_default='pending', nullable=False),
    sa.Column('video_id', sa.BigInteger(), nullable=True),
    sa.Column('error', sa.String(length=300), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("status IN ('pending','done','failed','skipped')", name='ck_import_items_status'),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('job_id', 'external_id', name='uq_import_items_job_external'),
    schema='kv_media'
    )
    op.create_index('idx_import_items_job', 'import_items', ['job_id', 'status'], unique=False, schema='kv_media')
    op.create_index(op.f('ix_kv_media_import_items_tenant_id'), 'import_items', ['tenant_id'], unique=False, schema='kv_media')
    op.create_table('channel_handles',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('tenant_id', sa.Integer(), nullable=False),
    sa.Column('channel_id', sa.BigInteger(), nullable=False),
    sa.Column('handle', sa.String(length=40), nullable=False),
    sa.Column('retired_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('reserved_until', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['kv_admin.tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('handle', name='uq_channel_handles_handle'),
    schema='kv_social'
    )
    op.create_index('idx_channel_handles_channel', 'channel_handles', ['channel_id'], unique=False, schema='kv_social')
    op.create_index(op.f('ix_kv_social_channel_handles_tenant_id'), 'channel_handles', ['tenant_id'], unique=False, schema='kv_social')
    op.add_column('notifications', sa.Column('app', sa.String(length=8), server_default='all', nullable=False), schema='kv_social')
    op.create_check_constraint("ck_notifications_app", "notifications", "app IN ('all','viewer','studio')", schema="kv_social")
    op.execute("UPDATE kv_social.notifications SET app = CASE WHEN kind IN ('new_video','reply','live','membership') "
               "THEN 'viewer' ELSE 'studio' END")
    for key, n in (("creator_free", 1), ("creator_pro", 5), ("creator_business", 25)):
        op.execute(f"UPDATE kv_commerce.plans SET limits = limits || '{{\"team_members\": {n}}}'::jsonb WHERE key = '{key}'")
    for spec in PARTITIONED:
        _partition(*spec)
    op.execute(MAINTAIN)
    op.execute("REVOKE ALL ON FUNCTION kv_admin.maintain_partitions(text, text, text, int, int) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION kv_admin.maintain_partitions(text, text, text, int, int) TO klygenix_video_app")
    op.execute("SELECT kv_admin.apply_tenancy()")
    op.execute("DROP POLICY IF EXISTS public_read ON kv_social.channel_handles")
    op.execute("CREATE POLICY public_read ON kv_social.channel_handles FOR SELECT USING (true)")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS kv_admin.maintain_partitions(text, text, text, int, int)")
    for spec in PARTITIONED:
        _unpartition(*spec)
    op.execute("SELECT kv_admin.apply_tenancy()")
    op.execute("UPDATE kv_commerce.plans SET limits = limits - 'team_members'")
    op.drop_constraint("ck_notifications_app", "notifications", schema="kv_social", type_="check")
    op.drop_column('notifications', 'app', schema='kv_social')
    op.drop_index(op.f('ix_kv_social_channel_handles_tenant_id'), table_name='channel_handles', schema='kv_social')
    op.drop_index('idx_channel_handles_channel', table_name='channel_handles', schema='kv_social')
    op.drop_table('channel_handles', schema='kv_social')
    op.drop_index(op.f('ix_kv_media_import_items_tenant_id'), table_name='import_items', schema='kv_media')
    op.drop_index('idx_import_items_job', table_name='import_items', schema='kv_media')
    op.drop_table('import_items', schema='kv_media')
    op.drop_index(op.f('ix_kv_media_import_jobs_tenant_id'), table_name='import_jobs', schema='kv_media')
    op.drop_table('import_jobs', schema='kv_media')
    op.drop_index('uq_tenant_members_open', table_name='tenant_members', schema='kv_admin')
    op.drop_index(op.f('ix_kv_admin_tenant_members_tenant_id'), table_name='tenant_members', schema='kv_admin')
    op.drop_index('idx_tenant_members_user', table_name='tenant_members', schema='kv_admin')
    op.drop_table('tenant_members', schema='kv_admin')

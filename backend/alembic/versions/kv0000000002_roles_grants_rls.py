"""roles, grants, row-level security, public read, append-only ledger, immutable evidence

Revision ID: kv0000000002
Revises: kv0000000001
"""
from typing import Sequence, Union

from alembic import op

revision: str = "kv0000000002"
down_revision: Union[str, None] = "kv0000000001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "klygenix_video_app"
SCHEMAS = ("kv_admin", "kv_media", "kv_social", "kv_ai", "kv_studio", "kv_commerce", "kv_ledger", "kv_tax", "kv_trust")
LIST = ", ".join(SCHEMAS)
QUOTED = ",".join(f"'{s}'" for s in SCHEMAS)

PUBLIC_READ = {
    "kv_media.videos": "status = 'published' AND visibility IN ('public','unlisted') AND NOT is_deleted",
    "kv_media.caption_tracks": "kv_media.video_readable(video_id)",
    "kv_social.channels": "true",
    "kv_social.comments": "status = 'visible' AND kv_media.video_readable(video_id)",
    "kv_social.danmaku": "status = 'visible' AND kv_media.video_readable(video_id)",
    "kv_social.playlists": "visibility = 'public'",
    "kv_social.playlist_items": "true",
    "kv_ai.transcripts": "is_current AND kv_media.video_readable(video_id)",
    "kv_ai.segments": "kv_media.video_readable(video_id)",
    "kv_ai.insights": "kv_media.video_readable(video_id)",
}


def upgrade() -> None:
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                CREATE ROLE {APP_ROLE} LOGIN PASSWORD '{APP_ROLE}';
            END IF;
        END $$;
    """)
    for schema in SCHEMAS:
        op.execute(f"GRANT USAGE ON SCHEMA {schema} TO {APP_ROLE}")
        op.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE}")
        op.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} GRANT USAGE, SELECT ON SEQUENCES TO {APP_ROLE}")

    op.execute("""
        CREATE OR REPLACE FUNCTION kv_admin.current_tenant() RETURNS integer
        LANGUAGE sql STABLE AS $fn$
            SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer
        $fn$;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION kv_admin.is_platform() RETURNS boolean
        LANGUAGE sql STABLE AS $fn$
            SELECT coalesce(current_setting('app.platform', true), '') = 'on'
        $fn$;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION kv_media.video_readable(vid bigint) RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = kv_media, pg_temp AS $fn$
            SELECT EXISTS (
                SELECT 1 FROM kv_media.videos v
                WHERE v.id = vid AND (
                    (v.status = 'published' AND v.visibility IN ('public','unlisted') AND NOT v.is_deleted)
                    OR v.tenant_id = kv_admin.current_tenant()
                    OR kv_admin.is_platform()
                )
            )
        $fn$;
    """)
    op.execute(f"GRANT EXECUTE ON FUNCTION kv_admin.current_tenant(), kv_admin.is_platform(), kv_media.video_readable(bigint) TO {APP_ROLE}")

    op.execute(f"""
        CREATE OR REPLACE FUNCTION kv_admin.apply_tenancy() RETURNS void
        LANGUAGE plpgsql AS $fn$
        DECLARE
            r record;
        BEGIN
            FOR r IN
                SELECT c.table_schema, c.table_name
                FROM information_schema.columns c
                JOIN information_schema.tables t
                  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
                WHERE c.column_name = 'tenant_id'
                  AND t.table_type = 'BASE TABLE'
                  AND c.table_schema IN ({QUOTED})
                  AND NOT (c.table_schema = 'kv_admin' AND c.table_name NOT IN ('audit_log','impersonation_sessions'))
                  AND NOT (c.table_schema = 'kv_commerce' AND c.table_name = 'provider_events')
                  AND NOT (c.table_schema = 'kv_ai' AND c.table_name = 'llm_calls')
            LOOP
                EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.table_schema, r.table_name);
                EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', r.table_schema, r.table_name);
                EXECUTE format(
                    'CREATE POLICY tenant_isolation ON %I.%I '
                    'USING (tenant_id = kv_admin.current_tenant() OR kv_admin.is_platform()) '
                    'WITH CHECK (tenant_id = kv_admin.current_tenant() OR kv_admin.is_platform())',
                    r.table_schema, r.table_name);
            END LOOP;
            EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {LIST} TO {APP_ROLE}';
            EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {LIST} TO {APP_ROLE}';
            EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON kv_ledger.journals, kv_ledger.journal_lines FROM {APP_ROLE}';
            EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON kv_admin.audit_log FROM {APP_ROLE}';
            EXECUTE 'REVOKE DELETE, TRUNCATE ON kv_commerce.provider_events FROM {APP_ROLE}';
        END
        $fn$;
    """)
    op.execute("SELECT kv_admin.apply_tenancy()")

    for table, predicate in PUBLIC_READ.items():
        op.execute(f"DROP POLICY IF EXISTS public_read ON {table}")
        op.execute(f"CREATE POLICY public_read ON {table} FOR SELECT USING ({predicate})")

    op.execute("""
        CREATE OR REPLACE FUNCTION kv_commerce.provider_events_immutable() RETURNS trigger
        LANGUAGE plpgsql AS $fn$
        BEGIN
            IF NEW.body IS DISTINCT FROM OLD.body
               OR NEW.signature_ok IS DISTINCT FROM OLD.signature_ok
               OR NEW.event_id IS DISTINCT FROM OLD.event_id
               OR NEW.rail IS DISTINCT FROM OLD.rail THEN
                RAISE EXCEPTION 'provider_events is evidence; its body and verdict are immutable';
            END IF;
            RETURN NEW;
        END
        $fn$;
    """)
    op.execute("DROP TRIGGER IF EXISTS trg_provider_events_immutable ON kv_commerce.provider_events")
    op.execute("""
        CREATE TRIGGER trg_provider_events_immutable
        BEFORE UPDATE ON kv_commerce.provider_events
        FOR EACH ROW EXECUTE FUNCTION kv_commerce.provider_events_immutable()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_provider_events_immutable ON kv_commerce.provider_events")
    op.execute("DROP FUNCTION IF EXISTS kv_commerce.provider_events_immutable()")
    for table in PUBLIC_READ:
        op.execute(f"DROP POLICY IF EXISTS public_read ON {table}")
    op.execute("DROP FUNCTION IF EXISTS kv_admin.apply_tenancy()")
    op.execute("DROP FUNCTION IF EXISTS kv_media.video_readable(bigint)")
    op.execute("DROP FUNCTION IF EXISTS kv_admin.is_platform()")
    op.execute("DROP FUNCTION IF EXISTS kv_admin.current_tenant()")

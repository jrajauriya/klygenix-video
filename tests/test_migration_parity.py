"""Alembic is the only schema path, and db-scripts/01-schema.sql is its snapshot (Pay's
rule 13). Build a throwaway database from each and compare every column and constraint —
table counts agreeing is not enough (the master estate learned that the hard way)."""

import os
import subprocess
import sys

from sqlalchemy import create_engine, text

from harness import DATABASE_URL, check, finish

ROOT = os.path.join(os.path.dirname(__file__), "..")
BASE = DATABASE_URL.rsplit("/", 1)[0]
SCHEMAS = ("kv_admin", "kv_media", "kv_social", "kv_ai", "kv_studio", "kv_commerce", "kv_ledger", "kv_tax", "kv_trust")

admin = create_engine(f"{BASE}/postgres", isolation_level="AUTOCOMMIT")
for name in ("parity_alembic", "parity_sql"):
    with admin.connect() as c:
        c.execute(text(f"DROP DATABASE IF EXISTS {name}"))
        c.execute(text(f"CREATE DATABASE {name}"))

env = {**os.environ, "DATABASE_URL": f"{BASE}/parity_alembic", "APP_DATABASE_URL": f"{BASE}/parity_alembic"}
r = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=os.path.join(ROOT, "backend"), env=env,
                   capture_output=True, text=True)
check("alembic upgrade head succeeds", r.returncode, 0)
if r.returncode:
    print(r.stderr[-2000:])

sql = open(os.path.join(ROOT, "db-scripts", "01-schema.sql")).read()
import psycopg  # noqa: E402

with psycopg.connect(f"{BASE}/parity_sql".replace("postgresql+psycopg://", "postgresql://"), autocommit=True) as raw:
    raw.execute(sql)


def shape(db: str) -> tuple[set, set]:
    with create_engine(f"{BASE}/{db}").connect() as c:
        cols = set(c.execute(text(
            "SELECT table_schema, table_name, column_name, data_type, is_nullable FROM information_schema.columns "
            "WHERE table_schema = ANY(:s)"), {"s": list(SCHEMAS)}).fetchall())
        cons = set(c.execute(text(
            "SELECT n.nspname, conname, contype FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace "
            "WHERE n.nspname = ANY(:s)"), {"s": list(SCHEMAS)}).fetchall())
    return cols, cons


a_cols, a_cons = shape("parity_alembic")
s_cols, s_cons = shape("parity_sql")
check("same columns", sorted(a_cols ^ s_cols)[:5], [])
check("same constraints", sorted(a_cons ^ s_cons)[:5], [])
check("tables present", len({(s, t) for s, t, *_ in a_cols}) >= 40, True)
with create_engine(f"{BASE}/parity_alembic").connect() as c:
    policies = c.execute(text("SELECT count(*) FROM pg_policies WHERE policyname = 'tenant_isolation'")).scalar()
check("row-level security on the tenant tables", policies >= 30, True)
with create_engine(f"{BASE}/parity_alembic").connect() as c:
    public = c.execute(text("SELECT count(*) FROM pg_policies WHERE policyname = 'public_read'")).scalar()
check("public-read policies on published content", public, 10)
finish()

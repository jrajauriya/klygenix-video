import os
from urllib.parse import unquote, urlsplit

import psycopg
from psycopg import sql

owner = os.environ["DATABASE_URL"]
app = urlsplit(os.environ.get("APP_DATABASE_URL") or "")
if not app.username or not app.password:
    raise SystemExit("APP_DATABASE_URL has no user or password; nothing to sync")
with psycopg.connect(owner, autocommit=True) as cx:
    if not cx.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (unquote(app.username),)).fetchone():
        raise SystemExit(f"role {app.username} does not exist; run the migrations first")
    cx.execute(sql.SQL("ALTER ROLE {} PASSWORD {}").format(sql.Identifier(unquote(app.username)), sql.Literal(unquote(app.password))))
print(f"app role {app.username}: password set from APP_DATABASE_URL")

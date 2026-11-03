import os

import psycopg

host = os.environ.get("SMTP_HOST", "mailpit")
port = int(os.environ.get("SMTP_PORT", "1025"))
sender = os.environ.get("SMTP_FROM_EMAIL", "contact@klygenix.com")
name = os.environ.get("SMTP_FROM_NAME", "Klygenix Play (staging)")
with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as cx:
    row = cx.execute(
        "SELECT id FROM kv_admin.email_configs WHERE config_type = 'global' AND smtp_host = %s AND smtp_port = %s",
        (host, port),
    ).fetchone()
    cx.execute("UPDATE kv_admin.email_configs SET is_active = FALSE WHERE config_type = 'global' AND smtp_host <> %s", (host,))
    if row:
        cx.execute("UPDATE kv_admin.email_configs SET is_active = TRUE, use_tls = FALSE WHERE id = %s", (row[0],))
    else:
        cx.execute(
            "INSERT INTO kv_admin.email_configs (config_type, tenant_id, smtp_host, smtp_port, smtp_username, smtp_password,"
            " from_email, from_name, use_tls, is_active, created_at, updated_at)"
            " VALUES ('global', NULL, %s, %s, 'staging', 'staging', %s, %s, FALSE, TRUE, now(), now())",
            (host, port, sender, name),
        )
    tenants = cx.execute("SELECT count(*) FROM kv_admin.tenants").fetchone()[0]
    channels = cx.execute("SELECT string_agg(handle, ',') FROM kv_social.channels").fetchone()[0]
print(f"mail -> {host}:{port} (global, no TLS); tenants={tenants} channels={channels}")

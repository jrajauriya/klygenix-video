# Rotating secrets

§22: *"Secrets rotated on a schedule; rotation is a documented runbook, not an archaeology
exercise."* One row per secret: what it protects, what rotating it breaks, and how.

Rotate on a schedule (**every 12 months**), and **at once** when anyone who held one leaves or
a leak is suspected. Every rotation that goes through the product lands on the audit trail as a
fingerprint change in `kv_core_tmp.audit_log`, so "did it take" has an answer. You can read it on
**Books → Audit trail** (`/ledger/audit`).

| Secret | Lives in | Rotating it | How |
|---|---|---|---|
| **JWT signing key** (`SECRET_KEY`) | `backend/.env.prod` | Signs everybody out: every session token stops verifying. API keys are unaffected (they are hashed, not signed). | Generate `python -c "import secrets; print(secrets.token_urlsafe(64))"`, set it, restart `backend`, `worker`, `scheduler`. Do it out of hours. |
| **Database owner password** (`POSTGRES_PASSWORD`, `DATABASE_URL`) | `.env.prod` | Migrations and `infra/*.sh` need it; the app does not use it at run time. | `ALTER ROLE klygenix_video PASSWORD '…'`, update `.env.prod`. |
| **Database app password** (`APP_DATABASE_URL`) | `.env.prod` | The API and workers stop connecting until they are restarted with the new one. | `ALTER ROLE klygenix_video_app PASSWORD '…'`, update `.env.prod`, restart all three. Minutes of downtime. |
| **Redis password** (`REDIS_PASSWORD`, `REDIS_URL`) | `.env.prod`, compose | Idempotency keys, rate limits and the queue pause while it restarts; the queue itself survives on disk. | Update both, `docker compose up -d redis backend worker scheduler`. |
| **Merchant's provider keys** (Razorpay) | `kv_ar_tmp.provider_accounts`, sealed | The merchant's payments stop until the new key is saved. | The merchant does it: Settings → Payment gateway → connect with the new key, then **Test**. |
| **Mail (SMTP) password** | `kv_admin.email_configs`, sealed | Mail stops until saved. The circuit breaker pauses sends to a mail server that is refusing, so fix it promptly. | Admin console → Email settings, then send the test email. |
| **Outbound webhook signing secret** | `kv_core_tmp.webhook_endpoints`, sealed | The subscriber rejects deliveries until they hold the new one. | Settings → Developer: create a new endpoint, move the subscriber over, delete the old one. |
| **API keys** | `kv_admin.api_keys`, hashed | Only the integration holding that key. | Settings → Developer: mint the replacement, switch the integration, revoke the old key. A key acts as its issuer, so revoking the person also revokes it. |
| **ERP connector password** | `kv_core_tmp.connections`, sealed | Syncs fail until updated. | Settings → Connections: switch it off, connect again with the new password (connecting revives the same connection, so its id map is kept), then **Sync**. |
| **Cloudflare origin certificate** | `infra/nginx/ssl/` | Nothing, if swapped before expiry. | Issue a new origin cert in Cloudflare, replace both files, `docker compose exec nginx nginx -s reload`. |
| **Master sealing key** (`backend/.secret.key`) | the host, mounted read-only | **Everything sealed** with it: provider keys, SMTP passwords, webhook secrets, connector passwords, vendor bank account numbers. Nothing breaks during a rotation. | `manage_secrets.py rotate` — see below. |

## The master sealing key

Every `enc:` value in the database (`secrets.SEALED`, six columns) and in `.env.prod` is sealed
with `backend/.secret.key` (Fernet).

```bash
cd backend
./venv/bin/python scripts/manage_secrets.py rotate --dry-run          # counts, changes nothing
./venv/bin/python scripts/manage_secrets.py rotate --env .env.prod    # the real thing
```

What it does, in order:

1. Moves the key to `.secret.key.previous` and writes a new one. From this moment the app
   decrypts with **either** key and encrypts with the new one, so nothing stops working.
2. Reseals every sealed database value in **one transaction** and reads each back under the
   new key before committing. Any failure rolls the whole thing back.
3. Writes one `credentials.resealed` row per tenant to the audit trail. The fingerprints are of
   the plaintext, so they do not change, which shows only the sealing moved.
4. Reseals every `KEY=enc:…` line in the env file.
5. Deletes `.previous`.

If it stops part-way, run it again. A leftover `.previous` means *finish the rotation*, and the
second run completes it. The containers run as uid 10001, so hand the new key to it
(`chown 10001:10001 backend/.secret.key && chmod 400 backend/.secret.key`; the next `deploy.sh` does it too),
then restart backend, worker and scheduler. Rehearsed on a copy
of the dev database: 100 values resealed, all readable under the new key alone, and a
simulated interruption resumed cleanly.

Keep the key off the repository and off backups (it is `.dockerignore`d and gitignored, and
mounted read-only), and keep a copy of the **new** key somewhere safe before deleting the old
one from anywhere else.

## After any rotation

1. Check the audit trail shows the fingerprint changed: **Books → Audit trail**, filtered to the
   record you rotated. Open the newest row to see the fingerprint before and after.
2. Run the smoke test in `infra/STAGING.md` §7 against the environment you rotated.
3. Write the date in the table below.

| Secret | Last rotated | By |
|---|---|---|
| | | |

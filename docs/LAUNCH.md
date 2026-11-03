# Klygenix Play — launch runbook

> **Not executed — no server yet (3 Nov 2026).** Nothing here has run against a real host or a live
> provider. Checked locally only: the readiness check (`tests/test_readiness.py`), the production
> stack on `play.localhost:8443` (`infra/local-stack.sh`) and the smoke test. When a step is first
> done for real, write the date and who did it next to it. **A deploy needs the owner's explicit go-ahead.**

Work top to bottom. The readiness check (step 7) is the gate: if it does not exit 0, Play does not open.

## 0. Who and what you need
- [ ] One owner for the launch with shell access to the VPS and admin access to every provider below.
- [ ] Company KYC documents (Razorpay live, Lemon Squeezy, Google OAuth verification, Apple and Google developer accounts).
- [ ] A vault "Klygenix Play — production" for every secret below.
- [ ] Seller identity for invoices: legal name, address, state code, GSTIN, support email, **grievance officer** (IT Rules: name, email, phone, address on the web's grievance page), refund policy.
- [ ] Legal text reviewed (terms, privacy, community guidelines, copyright/takedown, grievance): the web app has `[to be filled]` placeholders.
- [ ] Plan prices confirmed (seeded placeholders: Viewer Premium ₹149 / $4.99, Creator Pro ₹499 / $9.99, Creator Business ₹1,999 / $39.99).

## 1. Hosts and DNS
All behind Cloudflare (proxied) in `klygenix.com`. **The domain is one value**: `PUBLIC_DOMAIN` in
`backend/.env.prod` and the nginx container env; moving to `play.klygenix.ai` is config plus a certificate.

| Host | Record | Serves |
|---|---|---|
| `play.klygenix.com` | A → VPS | `apps/web`; `/` goes through `/api/video/render` for share previews; `/api/*` proxied |
| `studio.play.klygenix.com` | A → VPS | `apps/studio` |
| `admin.play.klygenix.com` | A → VPS | `apps/admin` (put Cloudflare Access in front) |
| `api.play.klygenix.com` | A → VPS | API + WebSocket (`/api/video/ws/…`); Bunny, Razorpay and Lemon Squeezy webhooks |

- [ ] Cloudflare → Network → **WebSockets on**, IP Geolocation on (`CF-IPCountry` picks the MoR currency).
- [ ] Bunny's pull zone host (`BUNNY_CDN_HOST`) is Bunny's, not ours — no DNS needed unless a custom CDN host is wanted.

## 2. TLS
- [ ] Full (strict). Origin certificate for `play.klygenix.com` + `*.play.klygenix.com` → `infra/nginx/ssl/origin.pem` / `origin-key.pem` on the VPS only (mode 600).

## 3. Server
- [ ] Ubuntu 24.04 in India. **Video needs more than Store:** 4 vCPU / 16 GB / 200 GB (Hostinger KVM 4) — the render worker is CPU-bound (`KV_RENDER_CPUS`, default 2). Encoding itself is Bunny's.
- [ ] Docker + compose plugin; firewall 22 (team IPs), 80/443 (Cloudflare ranges); PostgreSQL on 127.0.0.1 only.
- [ ] `mkdir -p /opt/klygenix-video/backups/{wal,base}` owned by uid 999.

## 4. Env files and the master key
| File | Holds |
|---|---|
| `infra/.env` | `POSTGRES_*`, `REDIS_PASSWORD`, `REDIS_URL`, `PUBLIC_DOMAIN=play.klygenix.com` |
| `backend/.env.prod` | every API setting (`backend/.env.example` lists them); `SANDBOX_ENABLED=false`, `JOBS_MODE=rq`, `PUBLIC_DOMAIN`, `WEB_BASE_URL`, `API_PUBLIC_BASE_URL`, `CORS_ORIGINS` (3 hosts), `SIGNUP_ENABLED` |
| `backend/.secret.key` | `python scripts/manage_secrets.py init` — **copy to the vault immediately** |

- [ ] Seal every secret as `enc:` (`scripts/manage_secrets.py`). YouTube refresh tokens are sealed in the database with the same key.

## 5. Providers, in order (docs/PROVIDERS.md has every key)
1. [ ] **Bunny Stream**: library, API key, token-auth key, webhook URL `https://api.play.klygenix.com/api/video/webhooks/media/bunny` → `VIDEO_PROVIDER=bunny`.
2. [ ] **Azure**: OpenAI deployment (chat + `text-embedding-3-small`), Speech → `LLM_*`, `EMBED_*`, `STT_PROVIDER=azure_speech`; budget alert at 80% of `LLM_MONTHLY_BUDGET_MINOR`.
3. [ ] **Safety vendor** (CSAM hash matching + classifier) → `SCAN_PROVIDER`. **Until it is live: `SIGNUP_ENABLED=false`** (Klygenix's own channel only).
4. [ ] **Razorpay** (Play's own keys) → webhook `https://api.play.klygenix.com/api/video/webhooks/payments/razorpay`, `PAYMENT_RAIL=auto`.
5. [ ] **Lemon Squeezy** (MoR abroad) → webhook `…/webhooks/payments/lemonsqueezy`, one subscription variant per plan.
6. [ ] **Google Cloud**: OAuth client (web), redirect `https://api.play.klygenix.com/api/video/channels/youtube/callback`, scopes `youtube.readonly` + `youtube.force-ssl`, **OAuth verification submitted** (takes weeks), YouTube Data API quota → `YOUTUBE_PROVIDER=google`.
7. [ ] **Email**: Microsoft Graph for contact@klygenix.com (as Store).
8. [ ] **Mobile**: Expo EAS project id, Apple and Google developer accounts; **upgrade to Expo SDK 58 first** (docs/SECURITY.md).
9. [ ] **Creator money**: CA sign-off (commission GST, TCS s.52 via GSTR-8, TDS 194-O, tips), commission rates per plan
   (placeholders 20/10/8%), tip limits, boost prices, refund window and reserve; Razorpay Route enabled on Play's
   account with `ROUTE_PROFILE_CATEGORY/SUBCATEGORY` confirmed; `BUNNY_TOKEN_KEY` on. Rehearse on staging: payout
   account → tip → release sweep → statement → refund after release → recovery.
10. [ ] **Dubbing and publishing**: `TTS_PROVIDER=azure`; `PUBLISH_PROVIDER=live` once YouTube upload is verified.

## 6. First deploy
- [ ] `bash infra/deploy.sh --dry-run`, then `VPS_HOST=root@<ip> bash infra/deploy.sh`: builds web/studio/admin, uploads the nginx template + `render.sh`, builds the image (ffmpeg inside), **runs readiness inside the new image and stops on a blocking failure**, migrates, syncs the app role, starts `backend`, `worker-ai`, `worker-render`, `scheduler`, restarts nginx.
- [ ] First boot seeds the admin tenant `klygenix-video-admin`, the global admin and Klygenix's channel `@klygenix`. Change the admin password, turn on two-step sign-in.

## 7. Readiness (must pass)
```bash
docker compose -f infra/docker-compose.prod.yml run --rm --no-deps -T backend python -m app.readiness --db
```
Blocking checks include `sandbox.disabled`, every provider switch off `sandbox`, `llm.configured`,
`scan.provider`, `age_gate`, sealed values, migrations at head, the default admin password changed.
Each open warning needs a written reason.

## 8. Backups and monitoring
- [ ] Cron `basebackup.sh` 02:30, `backup.sh` 03:00, `archive-metrics.sh` every 5 min (infra/BACKUPS.md). **Off-host copy:** set `BACKUP_TARGET` (+ `BACKUP_S3_*`); `backup.sh` ships, deep-verifies and prunes, and `KvBackupNotShipped` fires after 26 h without a verified copy. Rehearsal: `bash infra/backup-ship-rehearse.sh`. Media lives at Bunny; `private_uploads` (clip renders, images) is a Docker volume — include it in the off-host copy.
- [ ] `bash infra/monitoring.sh check` then start `docker-compose.monitoring.yml`. Play alerts: `KvPipelineBacklog`, `KvRenderWaiting`, `KvAiJobsFailing`, `KvLlmBudgetHigh`, `KvTakedownsOverdue` (infra/METRICS.md).

## 9. Smoke test
```bash
backend/venv/bin/python tests/smoke/post_deploy.py --base https://play.klygenix.com --metrics-token "$METRICS_TOKEN" --skip-purchase
```
Health, share previews, headers, caching, compression, CORS for studio/admin, the consoles. On a
staging host (sandbox on) run it without `--skip-purchase`: it signs up a creator, uploads a
fixture, waits for publish through the workers, plays the HLS and buys Creator Pro on the sandbox rail.

## 10. Go live
- [ ] Razorpay and Lemon Squeezy live keys; readiness again.
- [ ] Upload Klygenix's first videos from the studio; check transcripts, chapters, Ask, a clip render.

## 11. First-day checks
- [ ] A real ₹149 Premium purchase and refund: entitlement granted by the worker, GST invoice, ledger balances, lapse on refund.
- [ ] A real upload through Bunny: encoded webhook arrives, scan runs, AI cost appears in Admin → AI usage.
- [ ] Danmaku from two phones on one video (WebSocket through Cloudflare).
- [ ] A takedown filed from the web form appears in Admin → Takedowns with its clock.
- [ ] Logs: `docker compose -f infra/docker-compose.prod.yml logs --since 1h backend worker-ai worker-render scheduler | grep -iE "error|traceback"` empty or understood.

## 12. Rollback
Every deploy keeps the running backend image as `klygenix-video-backend:current-prev` and copies each frontend's
`dist` to `dist.prev` before uploading. To roll back: `VPS_HOST=… bash infra/deploy.sh --rollback` (add `--staging`
for staging) — it retags the previous image, restores the three frontends in place (the bind-mounted `dist`
directory is kept, only its contents change), restarts backend, workers, scheduler and nginx. Only one step back is
kept. Database: migrations are not reverted — forward-fix them; point-in-time restore for destructive mistakes
(infra/BACKUPS.md). The ledger and audit log are append-only. Rehearsed on 3 Nov 2026 against a throwaway SSH host
(deploy → second deploy → rollback, with a stub docker on the target).

## 13. Who to contact
| Provider | For | Where |
|---|---|---|
| Bunny | Stream, CDN, webhooks | https://support.bunny.net/ |
| Microsoft Azure | OpenAI, Speech quotas | Azure portal → Help + support |
| Google Cloud | OAuth verification, YouTube quota | https://support.google.com/cloud/ |
| Razorpay | live activation, disputes | Dashboard → Help & Support |
| Lemon Squeezy | MoR onboarding, payouts | https://www.lemonsqueezy.com/help |
| Cloudflare | DNS, certificates, WebSockets | Dashboard → Support |
| Apple / Google Play | app review | App Store Connect / Play Console |
| VPS host | hardware, network | Hostinger tickets |

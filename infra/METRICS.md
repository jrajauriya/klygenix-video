# Metrics

The API exposes Prometheus text format at `GET /metrics`.

| Setting | Behaviour |
|---|---|
| `METRICS_TOKEN` empty, production (`SANDBOX_ENABLED=false`) | disabled — `/metrics` answers 404 |
| `METRICS_TOKEN` empty, development | open, no token |
| `METRICS_TOKEN` set | requires `Authorization: Bearer $METRICS_TOKEN` |

Set it in `backend/.env.prod` (`METRICS_TOKEN=<random 32+ chars>`, `openssl rand -hex 32`).

## Where to scrape from

Scrape the backend on the compose network, `backend:9300/metrics`, not through the public
host. nginx also answers `https://api.play.klygenix.com/metrics`, but only to loopback and
private ranges (10/8, 172.16/12, 192.168/16); everything else — Cloudflare included — gets 403.

```yaml
scrape_configs:
  - job_name: klygenix-video-api
    metrics_path: /metrics
    scrape_interval: 30s
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/klygenix-video-metrics-token
    static_configs:
      - targets: ["backend:9300"]
```

A quick check from the host:

```bash
docker exec klygenix-video-backend python -c "import os,urllib.request as u; r=u.Request('http://localhost:9300/metrics', headers={'Authorization': 'Bearer '+os.environ['METRICS_TOKEN']}); print(u.urlopen(r).read().decode()[:600])"
```

## What is exported

| Metric | Type | Labels |
|---|---|---|
| `kv_http_requests_total` | counter | `method`, `route` (template, e.g. `/api/store/public/{handle}`), `status` |
| `kv_http_request_duration_seconds` | histogram | `method`, `route` |
| `kv_jobs_total` | counter | `job`, `outcome` (`ok` / `failed`) |
| `kv_webhook_deliveries_total` | counter | `direction` (`in` = gateway callbacks, `out` = integrator webhooks), `rail` (`integrator` for out), `outcome` (`ok` / `failed` / `pending` / `unverified`, out also `abandoned`) |
| `kv_payments_captured_total` | counter | `rail` |
| `kv_open_checkouts` | gauge | — |
| `kv_metrics_db_up` | gauge | — (0 when the figures below could not be read) |
| `kv_redis_up` | gauge | — (0 when the API could not read Redis for this scrape) |

Where each figure comes from:

- HTTP counters and the latency histogram are per API process (in memory). With several
  uvicorn workers, Prometheus sums them across targets.
- `kv_jobs_total` is counted in Redis (`ks:metrics:jobs`) by whichever process ran the job —
  API inline or an RQ worker — so the API's `/metrics` shows all of them.
- Payments, open checkouts and webhook deliveries are counted from the database (owner
  connection, so RLS does not hide rows) and cached for 10 seconds.

Alerts are defined in `infra/prometheus/alerts.yml`; see "Alerts" below.

## Host metrics written by cron (node-exporter textfile collector)

node-exporter reads `*.prom` files from `/var/lib/node_exporter/textfile_collector` (override with
`KV_TEXTFILE_DIR` for the scripts and the monitoring compose).

| Metric | Written by | Meaning |
|---|---|---|
| `kv_backup_last_success_timestamp_seconds`, `kv_backup_last_size_bytes` | `infra/backup.sh`, after `gzip -t` passes | when the last verified logical dump finished |
| `kv_wal_archived_total`, `kv_wal_archive_failed_total` | `infra/archive-metrics.sh` (cron, every 5 min) | `pg_stat_archiver` counters |
| `kv_wal_archive_last_archived_timestamp_seconds`, `kv_wal_archive_last_failed_timestamp_seconds` | same | last success / last failure of `archive_command` (0 = never) |

Disk figures are node-exporter's own `node_filesystem_avail_bytes` / `node_filesystem_size_bytes`
(`mountpoint`, `fstype`, `device` labels); the WAL archive and the backups live on `/`
(`/opt/klygenix-video/backups`), so the root filesystem alert covers them.

## Running Prometheus, Alertmanager and the uptime probes

Files: `infra/prometheus/{prometheus.yml,alerts.yml,alerts.test.yml,blackbox.yml,alertmanager.yml}`,
`infra/docker-compose.monitoring.yml` (prometheus, alertmanager, blackbox-exporter,
node-exporter), `infra/docker-compose.monitoring.local.yml` (local-stack overrides),
`infra/monitoring.sh` (check / up / status / down against the local stack).

The monitoring compose is its own project and joins the stack's network (`KV_STACK_NETWORK`,
default `infra_default` — the production project) so Prometheus reaches `backend:9300`.
Prometheus listens on `127.0.0.1:9190`, Alertmanager on `127.0.0.1:9193`; reach them through an
SSH tunnel.

Validate before every change (runs promtool, amtool and blackbox in their images):

```bash
bash infra/monitoring.sh check     # check rules + unit tests (alerts.test.yml) + check config + amtool + blackbox
```

Production (VPS):

```bash
sudo mkdir -p /var/lib/node_exporter/textfile_collector /opt/klygenix-video/monitoring
printf %s "$METRICS_TOKEN" | sudo tee /opt/klygenix-video/monitoring/metrics-token >/dev/null
sudo chmod 700 /opt/klygenix-video/monitoring && sudo chmod 644 /opt/klygenix-video/monitoring/metrics-token
# edit infra/prometheus/prometheus.yml: PRODUCT_SLUG -> an evergreen published product
# edit infra/prometheus/alertmanager.yml: add email_configs / telegram_configs / webhook_configs to "default"
cd /opt/klygenix-video/infra && docker compose -f docker-compose.monitoring.yml up -d
# cron: */5 * * * * bash /opt/klygenix-video/infra/archive-metrics.sh
```

Probes run from the VPS through Cloudflare to the public hostnames, so they test DNS, the edge
certificate and nginx together. They cannot see a VPS that is down entirely — pair them with an
outside check (Cloudflare health checks or any external pinger on `https://api.play.klygenix.com/health`).

Locally, against the production-shaped stack:

```bash
bash infra/local-stack.sh up
bash infra/monitoring.sh up        # renders infra/build/monitoring for store.localhost, runs backup.sh + archive-metrics.sh once, starts the four containers
bash infra/monitoring.sh status    # targets, rule states, probe_success
bash infra/monitoring.sh down && bash infra/local-stack.sh down
```

`up` points the probes at the stack's nginx container (extra_hosts), skips verification of the
self-signed certificate, and picks the first published product for the product-page probe.

Uptime probes (`job="blackbox"`, label `probe`):

| probe | URL | passes when |
|---|---|---|
| store | `https://play.klygenix.com/` | 200, a `<title>` and the app root (rendered by the API) |
| product-page | `https://play.klygenix.com/p/PRODUCT_SLUG` | 200 and a product title (`Name — Store`) — a missing product fails |
| render | `https://api.play.klygenix.com/api/store/render?path=/` | the render endpoint directly |
| api-health | `https://api.play.klygenix.com/health` | `"status":"ok"` and `"redis":"up"` |
| studio, admin, library | `/login`, `/login`, `/library/` | 200 and the app root |

Every probe is HTTPS-only (`fail_if_not_ssl`) and reports `probe_ssl_earliest_cert_expiry`.

## Alerts

`severity=critical` repeats hourly, `warning` every 4 hours. `KvApiDown` inhibits the API-derived
alerts; the critical disk and certificate alerts inhibit their warnings. Hours are UTC in
Prometheus: IST business hours 09:30–21:30 are `hour() >= 4 and hour() < 16`.

### KvApiDown
`up{job="klygenix-video-api"} == 0` for 2 minutes. Prometheus cannot scrape `/metrics`.
First response: `docker compose -f infra/docker-compose.prod.yml ps backend`; `logs --tail 200 backend`;
if the token changed, update `/opt/klygenix-video/monitoring/metrics-token`. Check `KvEndpointDown{probe="api-health"}` to tell "API down" from "scrape broken".

### KvApi5xxRate
More than 2% of requests are 5xx for 5 minutes (only with at least 3 requests a minute).
First response: `sum by (route) (rate(kv_http_requests_total{status=~"5.."}[5m]))` names the route; the
error tracker has the stack trace (tagged `route`, `tenant_id`, `request_id`); `logs backend | grep <request_id>`.
Roll back (docs/LAUNCH.md §13) if it started with a deploy.

### KvApiLatencyP95
p95 over all routes above 1.5 s for 10 minutes. First response: find the slow route with
`histogram_quantile(0.95, sum by (le, route) (rate(kv_http_request_duration_seconds_bucket[5m])))`;
check PostgreSQL (`pg_stat_activity`, locks), host CPU/IO, and whether a sweep or report is running.

### KvMetricsDbDown
The API's owner connection cannot read the database. First response: `docker compose ps postgres`,
`pg_isready`, disk space (`KvDiskSpaceCritical`), connection count. Checkouts will be failing too.

### KvRedisDown
The API cannot read Redis: jobs are not enqueued, rate limits and idempotency fail closed.
First response: `docker compose ps redis`, `logs redis`, memory; restart Redis, then check the
worker drained the backlog (`kv_jobs_total` moving).

### KvJobFailuresRising
A job failed 3+ times in 15 minutes (`KvJobFailuresSurge`: 20+ across all jobs). Jobs retry
three times, so this is past a transient blip. First response: the error tracker filtered by
tag `job`; `logs worker | grep '"job": "<name>"'`; RQ's failed registry
(`rq info --url $REDIS_URL`). Fix the cause, then requeue (`rq requeue --all`) — jobs are idempotent.

### KvWebhookInboundFailures
Gateway callbacks recorded as `failed` (processing raised) or `unverified` (signature mismatch)
in 15 minutes. `unverified` usually means a rotated or wrong webhook secret — compare the
gateway dashboard's secret with the sealed value; `failed` has a stack trace in the error
tracker. Missed callbacks are recovered by `/confirm` and the reconciliation sweep, but check
`kv_commerce.provider_events` for rows with `error`.

### KvWebhookInboundBacklog
The number of `pending` callbacks grew by more than 3 in 15 minutes: they are recorded but no
worker processes them. First response: `docker compose ps worker`, `logs worker`, Redis up;
restart the worker. Buyers are waiting for access (rule S02).

### KvWebhookOutboundFailures
More than 5 integrator webhook deliveries `failed`/`abandoned` in 30 minutes. Usually one
seller's endpoint is down: `select tenant_id, url, count(*) from kv_growth.webhook_deliveries where status in ('failed','abandoned') and created_at > now() - interval '1 hour' group by 1,2`.
Tell the seller; nothing to fix on our side unless every tenant fails.

### KvNoPaymentsBusinessHours
No payment captured in 2 hours during IST business hours (warning). First response: place a
₹1 test purchase; check `KvWebhookInboundBacklog`, the Razorpay dashboard status page, and that
`KvOpenCheckoutsSpike` is not also firing (buyers start but cannot pay). Silence it before launch
and on known-quiet days.

### KvOpenCheckoutsSpike
Open/pending checkouts above 50 and over 3x the previous day's average for 15 minutes. Either a
real surge (a launch or a campaign) or buyers who cannot finish paying. Compare with
`increase(kv_payments_captured_total[1h])`; if payments are flat, treat it as a payment outage.

### KvDiskSpaceLow
A filesystem under 15% free (`KvDiskSpaceCritical` under 5%, `KvDiskFillingFast` full within
24 h by trend). First response: `df -h`, `du -sh /opt/klygenix-video/backups/*`,
`docker system df`; prune old images (`docker image prune -a` after a successful deploy),
check `backup.sh`'s 30-day retention and `basebackup.sh`'s WAL cleanup ran. PostgreSQL stops at 0%.

### KvWalArchiveFailing
`archive_command` failed more recently than it succeeded, for 15 minutes; `KvWalArchiveStale`:
nothing archived for 2 hours; `KvWalArchiveMetricMissing`: the cron is not writing. PITR is not
being kept and `pg_wal` grows until the disk fills. First response:
`docker logs klygenix-video-postgres | grep archive`; ownership of `/opt/klygenix-video/backups/wal`
(uid 999); free space. Once fixed, run `basebackup.sh` so a new base backup starts a clean chain.

### KvBackupStale
The last verified `backup.sh` dump is older than 26 hours (`KvBackupMetricMissing`: no metric at
all after 26 h — cron missing or the textfile dir not writable). First response: `crontab -l`,
`tail /var/log/klygenix-video-backup.log`, run `bash infra/backup.sh` by hand.

### KvBackupNotShipped
The dumps, base backups and WAL have not reached `BACKUP_TARGET` and verified for 26 hours: a lost
host now loses data. First response: `tail /var/log/klygenix-video-backup.log`; run
`bash infra/backup-ship.sh verify`; check the bucket credentials and that the host can reach the
endpoint; then `bash infra/backup-ship.sh push /opt/klygenix-video/backups`.

### KvExporterDown
node-exporter or blackbox-exporter is not scraped: host and uptime alerts are blind.
`docker compose -f infra/docker-compose.monitoring.yml ps`; restart it.

### KvEndpointDown
A public probe failed for 3 minutes (`KvEndpointSlow`: slower than 3 s on average for 10 min).
`probe_http_status_code`, `probe_failed_due_to_regex` and the blackbox debug page
(`/probe?target=<url>&module=<module>&debug=true` on the blackbox container) say why. `store`/
`product-page`/`render` share the render endpoint; `studio`/`admin`/`library` are static files from
nginx (check the last deploy uploaded `dist/`); `api-health` failing on `redis` means Redis.

### KvCertExpiringSoon
A probed certificate expires in under 14 days (critical under 3). The edge certificate is
Cloudflare's and renews itself — if this fires, check the zone's Edge Certificates page. The origin
certificate (`infra/nginx/ssl/origin.pem`, 15 years) is not probed through Cloudflare.

## Error tracking (Sentry protocol — sentry.io or self-hosted GlitchTip)

Off unless a DSN is set; with no DSN nothing is initialised and nothing is sent.

| Setting | Where | Default |
|---|---|---|
| `SENTRY_DSN` | backend env | empty (off) |
| `SENTRY_BROWSER_DSN` | backend env: the front-end project the tunnel forwards to, if it is not `SENTRY_DSN`'s | empty |
| `SENTRY_ENVIRONMENT` | backend env | `production`, or `sandbox` while `SANDBOX_ENABLED` |
| `SENTRY_RELEASE` | baked into the image (`ARG SENTRY_RELEASE`, `deploy.sh`/`local-stack.sh` pass `klygenix-video@<git sha>`) | git sha in a checkout |
| `SENTRY_TRACES_SAMPLE_RATE` | backend env | `0` (errors only) |
| `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_RELEASE`, `VITE_SENTRY_TUNNEL` | exported when the apps are built | empty (off); release = git sha from `deploy.sh`; tunnel = `<VITE_API_URL>/api/observe/tunnel` (`direct` to bypass) |

Backend: `sentry-sdk` with the FastAPI, Starlette, SQLAlchemy, Redis, RQ and logging
integrations (`app/core/services/error_tracking.py`), initialised in `app/main.py` (API), the
RQ worker (`rq worker -c app.store.jobs.rq_boot`) and the scheduler. Every failed job is captured
with a `job` tag and flushed, in RQ workers and in the inline runner. Events carry tags
`component` (api/worker/scheduler), `tenant_id` (never a buyer id), `route` (the template, e.g.
`/api/store/public/{handle}/checkouts`) and `request_id` (the `X-Request-Id` in the logs).

Frontend: `packages/observe` — `@sentry/react` is loaded by dynamic import only when
`VITE_SENTRY_DSN` was set at build time; without it the bundles contain no Sentry code
(`tests/e2e/obs.mjs` greps `dist-e2e`). React 19 root error hooks and a top-level error boundary
report render errors; no user is ever attached (the storefront stays session-free), release
health sessions are off, and performance sampling is 0.

The browser posts to our own `POST /api/observe/tunnel` (the API origin; same-origin through
`/api` on the storefront and library), which re-scrubs each envelope and forwards it only for the
configured DSN's project (`SENTRY_BROWSER_DSN`, else `SENTRY_DSN`) — so no CSP change is needed.
`VITE_SENTRY_TUNNEL=direct` posts to the DSN host instead; then set `SENTRY_CONNECT_SRC` at deploy
(docs/SECURITY.md, "Browser error reports and the CSP").

What is scrubbed before an event leaves the process (server and browser apply the same rules):

- `send_default_pii=False` (browser: `dataCollection` with no user info, cookies, bodies or
  query strings, only the `User-Agent` header); local variables are never collected.
- Headers dropped: `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`,
  signature headers, `Referer`, forwarding IP headers. Cookies and the user object are removed.
- Request bodies dropped entirely on auth, account, checkout, library, affiliate, webhook,
  payout, sign-in, lead, password/TOTP and data-rights routes; elsewhere scrubbed.
- Query parameters named `token`, `link`, `code`, `signature`/`sig`, `key`, `otp`, `email`,
  `phone` (and `*_token` etc.) become `[Filtered]` — also inside URLs in messages and
  breadcrumbs, and percent-encoded inside other URLs.
- Everywhere (message, exception, extra, contexts, tags, breadcrumbs): email addresses,
  Indian phone numbers (+91 / 0 / 10 digits from 6–9), PAN, GSTIN, IFSC, 9–18 digit account
  numbers and card numbers, JWTs, `Bearer` values, `kv_live_`/`rzp_` keys and sealed `enc:`
  values are replaced (`[email]`, `[phone]`, `[pan]`, `[gstin]`, `[ifsc]`, `[number]`, `[jwt]`,
  `enc:[sealed]`). Dict keys that name secrets or personal fields (password, token, key, code,
  otp, pan, gstin, ifsc, account_number, email, phone, …) are replaced whole.
- Browser breadcrumbs for input fields are dropped; URL fragments are removed.

Verify locally without any remote service: `tests/obs/fake_sentry.py` is a Sentry-protocol ingest
that writes envelopes to a JSON file; `tests/test_error_tracking.py` starts it and a second API on
a spare port with `SENTRY_DSN=http://public@127.0.0.1:<port>/1` and
`ERROR_TRACKING_DEBUG_ROUTES=true` (the `/api/_debug/*` routes exist only with that flag **and**
`SANDBOX_ENABLED`), triggers a route error, a failing inline job and a failing RQ job seeded with
emails, phones, PAN, GSTIN, IFSC, account numbers, tokens and a sealed value, and asserts none
of them reach the envelope — then repeats with no DSN and asserts nothing arrives.

## Play pipeline alerts

### KvPipelineBacklog
Videos sat in `processing` or `scanning` for over ten minutes. Check `worker-ai` is up (`docker compose ps`), its log, and the `ai` queue length in Redis (`rq info --url $REDIS_URL`). A Bunny "encoded" webhook that never arrived shows as `processing`: look in `kv_commerce.provider_events` for the video's provider id.

### KvRenderWaiting
Clips queued or rendering for over five minutes. `worker-render` is down or saturated; it is CPU-bound and capped by `KV_RENDER_CPUS`. Restart it, or raise the cap on a bigger host.

### KvAiJobsFailing
Over a fifth of AI jobs in the last fifteen minutes failed. Look at `kv_ai.ai_jobs.error` and `kv_ai.llm_calls`: an open breaker or an exhausted Azure quota fails every job; the quota is released, so retry with `/reprocess` once fixed.

### KvLlmBudgetHigh
Spend this month passed 80% of the default `LLM_MONTHLY_BUDGET_MINOR`. Past the budget the client refuses new calls and Ask declines. Raise the budget or check `kv_ai.llm_calls` for a runaway purpose.

### KvLiveIngestDown
A stream is marked live but no segment arrived for 20 seconds. Usually the creator's encoder dropped; the stream auto-ends after `LIVE_IDLE_END_SECONDS`. If several fire at once, check the `live` container (sandbox ingest) or the Cloudflare Stream status page, and `docker compose logs live`.

### KvLiveFanoutSlow
The realtime hub dropped messages because sockets could not keep up (queue of 500 per socket). A very large room or an overloaded API: check CPU of the backend workers, raise `KV_API_WORKERS`, and look for a slow Redis (`redis-cli --latency`).

### KvTakedownsOverdue
A takedown passed its resolve deadline (IT Rules: 24 h for intimate imagery, 15 days otherwise). Open Admin → Takedowns and decide it now.

## Run 4 alerts

### KvTrustOverdue
A takedown or grievance notice was not acknowledged within its clock (`TAKEDOWN_SLA_HOURS`, 24 h by default — IT Rules
2021). Resolution deadlines are `KvTakedownsOverdue`. Open Admin → Takedowns, acknowledge it (the complainant already got
the automatic receipt mail) and decide it.

### KvAdDeliveryErrors
More than 5% of `/api/video/ads/*` calls fail. Viewers still get the video (the player skips a failed ad), but campaigns
under-deliver. Check the API log for the traceback, Redis health (impressions and caps live there) and the creative's
playback (a deleted or blocked creative video). Pausing a campaign in Admin → Advertising stops its decisions at once.

### KvRecoModelStale
The active recommendation model is over three days old: the nightly job (02:30 IST) is training but not promoting, or
not training. Admin → Recommender shows the last candidates and their offline metrics; a candidate that does not beat
the heuristic is never promoted automatically. Setting `RECO_MODEL=off` returns every viewer to the heuristic feed.

## Run 5 alerts

### KvAdInvalidTrafficHigh
More than 20% of viewable ad impressions in the last hour were invalid (bots, data-centre IPs, bursts, a different
viewer sending the events, events faster than playback). Invalid impressions are never billed, but a spike usually means
a scraper or a fraud attempt on one channel: Admin → Advertising → Invalid traffic shows the reasons and the campaigns.
Raise `ADS_IVT_CIDRS` with the offending ranges, or pause the campaign.

### KvDigestNotSent
The daily notification digest (08:00 IST sweep) has not run for over 26 hours. Check the scheduler and the mail outbox
(Admin → Beta → Outbox) for failures; the digest is safe to re-run — notifications are marked once sent.

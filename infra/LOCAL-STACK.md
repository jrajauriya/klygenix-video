# The production stack, locally

`infra/local-stack.sh` runs the production compose file on this machine with the staging
override on top: the same backend image, RQ worker and single scheduler, PostgreSQL with WAL
archiving, password-protected Redis, and nginx with the same `prod.conf` and header snippets —
only the hostnames, the certificate, the payment rail and the mail server differ. Use it to
check a change to Docker, nginx, env wiring or the build before it goes near a server.

It does not touch the development environment: its own compose project
(`klygenix-video-staging`), its own containers (`klygenix-video-staging-*`) and volumes, no
PostgreSQL or Redis port on the host, and nginx on `127.0.0.1:8443` / `:8080`. The dev API
(9300), apps (5302–5103), PostgreSQL (25436) and Redis (16383) keep running beside it.

## Run it

```bash
bash infra/local-stack.sh up          # build, migrate, start; prints URLs and the admin password
bash infra/local-stack.sh smoke       # tests/smoke/post_deploy.py against it — must end GREEN
bash infra/local-stack.sh csp         # tests/e2e/csp.mjs: key pages through nginx, no CSP violation, font bytes
bash infra/local-stack.sh status
bash infra/local-stack.sh logs worker
bash infra/local-stack.sh down        # keep the data;  down --purge  also drops the volumes
```

Needs Docker, Node (the apps are built on the host), `openssl` and `python3`. The first `up`
pulls `postgres:17`, `redis:7.4-alpine`, `nginx:1.25-alpine` and `axllent/mailpit`, and builds the
backend image; later runs take about a minute. `up --skip-web` reuses the last app builds.

| | URL |
|---|---|
| Storefront | https://store.localhost:8443/ |
| Library | https://store.localhost:8443/library/ |
| Studio | https://studio.store.localhost:8443/login |
| Admin console | https://admin.store.localhost:8443/login |
| API | https://api.store.localhost:8443/health |
| Mail sink (mailpit) | http://127.0.0.1:18025/ |

`*.localhost` resolves to the loopback address in browsers, curl and Python's resolver on macOS;
the smoke test maps it itself elsewhere. The certificate is self-signed for `store.localhost`
and `*.store.localhost`: accept it once per host in the browser (all four hosts, the API
included, or the consoles' API calls fail silently).

## What `up` does

1. `infra/.env.staging` — created from `.env.staging.example` on first run, every
   `CHANGE_ME_*` replaced with a random value (gitignored). Sign in as `GLOBAL_ADMIN_EMAIL` with
   the generated `GLOBAL_ADMIN_PASSWORD`; `up` prints both.
2. `infra/build/staging/` (gitignored) — a self-signed certificate, a Fernet `secret.key`, and
   `render-staging.sh` output: `prod.conf` and the snippets with `play.klygenix.com` rewritten to
   `STAGING_DOMAIN` and the CSP's API origin to `https://api.store.localhost:8443`, plus the four
   apps built with `vite build` and the matching `VITE_*` URLs (the storefront and library
   same-origin, the library under `/library/`). `apps/*/dist` is never touched, so the dev API's
   share-preview shell is unchanged.
3. Builds `klygenix-video-backend:staging` (one image for backend, worker and scheduler, all running as
   uid 10001), then, in a one-off root container, hands `secret.key` (mode 0400) and the uploads volume to
   that uid.
4. Starts PostgreSQL, Redis and mailpit; runs `alembic upgrade head` in the image; runs
   `infra/sync-app-role.py`, which sets `klygenix_video_app`'s password to the one in
   `APP_DATABASE_URL` (the migration creates it with a password equal to its name).
5. Starts the backend (whose boot seeds the admin tenant, the global admin and the `klygenix`
   store), then the worker, the scheduler (after the backend is healthy) and nginx.
6. `infra/staging/seed.py` makes the global row in `kv_admin.email_configs` point at mailpit
   (no TLS, any login accepted) — the mailer reads that table, not `SMTP_*`.

The override forces `SANDBOX_ENABLED=true`, `PAYMENT_RAIL=sandbox` and `JOBS_MODE=rq`, keeps the
WAL archive and base backups in volumes instead of `/opt/klygenix-video/backups`, and shares one
`private_uploads` volume between backend, worker and scheduler (invoices written by the worker
are served by the backend). Production uses S3 instead.

## The smoke test

`tests/smoke/post_deploy.py` checks a deployed stack from the outside. `local-stack.sh smoke`
runs it with `--insecure`, the admin credentials, the metrics token, the plain-http origin and
the mailpit API. Against a server:

```bash
backend/venv/bin/python tests/smoke/post_deploy.py --base https://play.klygenix.com --skip-purchase --metrics-token "$METRICS_TOKEN"
backend/venv/bin/python tests/smoke/post_deploy.py --base https://staging.example.com --studio-email admin@klygenix.com --studio-password '…'
```

It checks, printing `[PASS]`/`[FAIL]`/`[SKIP]` per line and exiting 1 with a list of failures:

- `/health` 200 with Redis up; the store host proxies `/api`.
- `/api/store/render?path=/@klygenix`, `/` and `/@klygenix` through nginx: HTML with `<title>`,
  `og:title`, `og:description`, `og:type` in the head; `/` answers `HEAD`.
- Per host (storefront, library, API, the store host's `/api`, studio, admin): HSTS ≥ 180 days,
  `nosniff`, the right `X-Frame-Options`, exactly one CSP, a Referrer-Policy; the storefront,
  studio and admin CSP allow the API origin.
- `/metrics` refused without a token and with a wrong one; with `--metrics-token`, 200 and
  `kv_http_requests_total` (a 403 from nginx's private-range rule is reported as SKIP — scrape
  `backend:9300` instead, infra/METRICS.md).
- CORS preflight from the studio and admin origins.
- Studio and admin `/login` and the library load, their bundle is served as JavaScript with
  `Cache-Control: … immutable` and a one-year max-age, gzip (or br) with `Vary: Accept-Encoding`;
  library assets sit under `/library/`, and a library deep link falls back to the app.
- A sandbox purchase through the public API as a browser makes it (skipped with
  `--skip-purchase`): signs in to the studio, creates and publishes a ₹1 `post` product titled
  "Smoke test" if it is missing, checkout → buyer details → pay → sandbox pay, waits for the
  worker to mark it paid with an `ORD/` number, signs in to the library with the thank-you
  page's one-use link, finds the purchase there, and checks the link cannot be used twice. With
  `--mailpit`, also that the buyer's email reached the sink.

On Docker Desktop, requests to nginx arrive from the Docker bridge, a private address, so the
`/metrics` location lets them through to the backend's token check. On the server the same
request from the internet gets nginx's 403.

## Deploy script

`infra/deploy.sh --dry-run [--staging]` prints every step — the host secrets check, typecheck,
builds, uploads, image build, readiness gate, migrations, app-role sync, restart — without
building, uploading or running anything. It is the way to exercise the script here; never point
it at a host from this machine without the owner's go-ahead.

The readiness gate runs `python -m app.readiness --env-file <env> --json` inside the freshly
built image on the host, before any container is restarted, and `infra/readiness-gate.py`
aborts the deploy on any failed blocking check. `--staging` tolerates the checks a staging box
fails by design (`sandbox.disabled`, `payment.rail`, `razorpay.keys`, `razorpay.live`,
`storage.s3`); everything else, including localhost URLs, still blocks. `--skip-readiness`
bypasses the gate with a loud warning.

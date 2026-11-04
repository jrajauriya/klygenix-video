# Klygenix Play — Development Context

## Company
Klygenix Technologies Private Limited. **Klygenix Play** is a fourth platform, separate from the
master estate (CRM / ERP / DMS / HR in `../ixaitech`), Klygenix Pay (`../klygenix-pay`), Store
(`../klygenix-store`) and Insurance (`../klygenix-insurance`): its own repository, database,
control plane and server. Forked from Store (FastAPI, same conventions); the AI client is
Insurance's; the Expo setup is Pay's. Those repos are read-only from here.

Brand **Klygenix Play**, hosts `play.klygenix.com` (web), `studio.play.`, `admin.play.`, `api.play.`.
The domain is one value: `PUBLIC_DOMAIN` (backend `.env.prod`, nginx env) and `VITE_PUBLIC_DOMAIN`.
Internal names stay "video": npm `@klygenixvideo/*`, schemas `kv_*`, database and owner role
`klygenix_video`, app role `klygenix_video_app`, containers `klygenix-video-*`, admin tenant
`klygenix-video-admin`, feature keys `video.*`, metrics `kv_*`.

The plan is `../Klygenix_Docs/Klygenix_Video/klygenix-video-master-plan.html` (`§NN`, rules
V01–V14). **It outranks this file on intent; this file outranks it on mechanics.**
Progress: `docs/BUILD-PLAN.md`. Gaps between frontends and API: `docs/API-GAPS.md`.

## What it is
An AI video platform: long videos and reels, uploaded or embedded from the creator's own YouTube /
Bilibili channel; AI transcripts, chapters, summaries, search inside videos, Ask-the-video with
cited timestamps, clip suggestions rendered to 9:16 reels with burned captions; danmaku (bullet
comments) over the player in realtime; creator plans and viewer Premium (Razorpay in India, a
merchant of record abroad); trust & safety with scans, reports, strikes, appeals, takedowns.

## Status
V0 + V1 (run 1), V2 Earn + V3 Community & learning (run 2), V4 Live + mobile store-ready + launch hardening (run 3)
and run 4 (provider go-live readiness, trust & safety gaps, closed beta, and V5.1 ads / V5.2 sponsorships / V5.3 TV web
app / V5.5 trained recommender started early by the owner) and run 5 (ad integrity & brand safety, Hindi & India-first,
viewer growth, creator AI v2, V5.4 regions and V5.6 view pool) built and running **locally on sandbox
providers**, not deployed (Nov 2026). Creator money runs on the sandbox rail only: live money waits for
CA sign-off, creator KYC and Play's Razorpay Route keys. Every provider has a sandbox adapter and a real
one behind the same interface, switched by `.env`. See `docs/BUILD-PLAN.md` for what is proven,
sandbox-only and blocked.

## Ports
| Service | Dev | Preview | Prod |
|---|---|---|---|
| apps/web | 5300 | 5310 | play.klygenix.com |
| apps/studio | 5301 | 5311 | studio.play.klygenix.com |
| apps/admin | 5302 | 5312 | admin.play.klygenix.com |
| apps/tv (10-foot web) | 5303 | 5313 | tv.play.klygenix.com |
| apps/mobile (Metro) | 8082 | — | iOS / Android (Expo) |
| API (+ WebSocket) | 9300 | — | api.play.klygenix.com |
| PostgreSQL 17 + pgvector | 25436 | — | 127.0.0.1:5432 |
| Redis | 16383 | — | compose network |
| Live RTMP gates (sandbox ingest) | 19350–19359 (ffmpeg listens on +1000, loopback) | — | Cloudflare Stream |

Clear of the estate (4000s/9000/25432/16379), Pay (5000s/9100/25433/16380), Store (5100s/9150/25434/16381)
and Insurance (25435).

## Structure
```
backend/app/
├── main.py, config.py        every setting has a dev default; sandbox providers by default
├── providers_check.py        which providers are real, missing/unsealed keys, webhook URLs; --live probe (launch day)
├── core/                     FORKED FROM STORE — tenants, users, auth, two gates, audit, api keys, readiness, metrics
├── ai/                       llm.py (Insurance: Azure Responses, breaker, budget, llm_calls) · stt · embed (1536) · textkit · captions · intel
└── video/
    ├── models/               media · social · ai · studio · commerce · trust · ledger · tax  (schemas kv_media … kv_trust)
    ├── media/                providers/{base,bunny,sandbox} · ffmpeg · signing · service (upload ticket, webhooks, playback)
    ├── pipeline/jobs.py      process_media_event → process_video: quota → STT → scan → publish → insights → embeddings → clip ideas
    ├── studio/               render.py (Pillow caption frames + ffmpeg 9:16, watermark, music + ducking) · jobs
    │                         · reframe (keyframes, smoothing, piecewise crop) · faces (sandbox marker / OpenCV Haar)
    │                         · music (licensed library) · publishers (YouTube Shorts, Instagram Reels, sandbox)
    ├── social/               counters (Redis, flushed + view_daily incl. retention buckets and sources) · feed ranking
    │                         · reco (video vectors, viewer taste) · cards (viewer state) · filter
    ├── realtime/rooms.py     WebSocket rooms over Redis pub/sub (stateless gateway) · hub.py (one pubsub per process)
    ├── live/                 service (streams, keys, signed playback) · worker (Supervisor: gates, ffmpeg listeners, go-live,
    │                         idle end, replay) · gate (RTMP publish-key check) · cloudflare (inputs, RS256 playback tokens,
    │                         webhook checks) · cf_events (record → process; idle end and replay import sweep)
    ├── ads/                  service (eligibility, decisions, Redis events, viewability, flush, accrual, creator share, view pool,
    │                         refunds) · integrity (bot UAs, data-centre ranges, bursts, brand-safety categories)
    │                         · sponsorships (escrowed deals, delivery label, approve/auto-approve, disputes)
    ├── reco/                 model (numpy logistic ranker, AUC/NDCG, synthetic viewers) · service (features, impression log,
    │                         labels, train/promote, A/B arm)
    ├── services/push.py      sandbox | Expo push, per-user switches, dedupe keys · retention.py (sweep policy)
    ├── channels/             youtube.py (OAuth, own videos, captions; sandbox fake channel) · embeds
    ├── trust/                age gate · scan (sandbox markers + hash list) · reports, strikes, appeals, takedowns
    ├── commerce/             plans, quotas (reserve/commit/release), checkout, payments worker, invoices
    │                         · support (tips, boosts, memberships, paid videos/series) · splits (Route split, hold, reserve,
    │                           release, refund unwind) · payouts (linked account + KYC) · refunds · entitlements.revoke()
    │                           · access (members/paid gate) · statements (commission invoices, GSTR-8, 194-O)
    ├── rails/ ledger/ tax/ storage/ documents/ reports/   from Store
    ├── routers/              watch · social (+ws, feeds, history, related) · ai (search, ask, captions) · billing · trust · channels
    │                         · me (export, erase, push tokens) · playlists (+series progress) · parties (watch parties, +ws)
    │                         · studio_videos (+thumbnail ideas) · studio_clips · studio_insights (analytics, comment inbox)
    │                         · admin_video · sandbox · webhooks · limits · debug
    │                         · support · studio_earnings (payouts, tiers, prices) · admin_money (refunds, transfers, tax files)
    │                         · products · learning (study sets, notes, quiz, Ask across a channel/series)
    │                         · community (posts, polls, moderators, translation, comment summary) · dubbing
    │                         · beta (waitlist, invites, feedback, onboarding, outbox) · ads · sponsorships
    │                         · growth (downloads, inbox, digest, subscriptions) · studio_ai (AI thumbnails, chapters,
    │                           repurpose pack, calendar)
    ├── jobs/                 RQ queues ai / render / default · scheduler · sweeps
    └── sessions.py           tenant_session() / platform_session()
packages/  ui auth client types config fonts observe (from Store) · player (hls.js, DanmakuLayer, ChapterBar, YouTube/Bilibili embeds, DanmakuRail)
apps/      web (viewer) · studio (creator + brand mode) · admin (platform) · mobile (Expo: Feed, Watch, Create, Profile)
           · tv (10-foot web: D-pad focus, device-code sign-in)
db-scripts/ 01-schema.sql + 02-reference-data.sql (dump-schema.sh) · make_fixtures.py · seed-demo.py
tests/     python suites against a live API (harness.py) · fixtures/media · e2e/ · smoke/ · load/
infra/     docker-compose.{dev,prod,staging}.yml · nginx templates + render.sh · deploy.sh · local-stack.sh · prometheus · security
```

## Rules
**Owner's working rules:** never commit or push (the owner commits by hand, no Co-Authored-By lines);
no comments or docstrings in new code — at most one single-line comment where it truly matters;
never deploy or call a live provider without the owner's go-ahead.

Pay's rules 01–17 and Store's S01–S12 apply where they fit (money in minor units, server prices the
checkout, only a worker on a verified payment grants, one revoke, `post()` is the only journal
writer, webhooks verify-record-enqueue, idempotent jobs, Alembic only, `tsc -p tsconfig.app.json`,
`@source` every package, `useConfirm()` never `window.confirm`). Play's own (§21):

- **V01** Video bytes never touch the API in production — direct signed/TUS upload to the provider,
  signed CDN playback. (The sandbox provider's PUT endpoint exists only with `SANDBOX_ENABLED`.)
- **V02** AI only on hosted videos or embeds with owner-imported captions. No adapter downloads media.
- **V03** Every Ask answer cites retrieved segments; uncited → "This video doesn't cover that".
- **V04** Nothing drawn over another platform's player; the source is credited and linked.
- **V05** Quota reserved before the job is queued, released on failure; every LLM call is costed.
- **V06** A view is not a write — counters in Redis, flushed by the scheduler.
- **V07** Realtime servers hold no state.
- **V08** Encoded is not published — scan passes or a moderator approves.
- **V09** Rights declared at upload. **V10** No per-view payouts. **V11** Licensed audio only.
- **V12** AI-made is labelled. **V13** Age gate on the server (18 IN, 16 some EU, 13 elsewhere).
- **V14** Nothing is encoded on the phone.

## Access control
Two gates, both on the server: `kv_admin.tenant_features` (plan has the menu) and
`kv_admin.role_permissions` (role may). `routers/deps.studio(key, level)` checks both; admin
routes use `deps.platform(key)`. Every sign-up gets a personal tenant (Insurance pattern); opening a
channel gives the tenant a `kv_social.channels` row. Viewers are ordinary users; there are no
separate buyer tokens. Adding a studio screen: key in `core/services/feature_catalog.py` → role
defaults in `permission_defaults.py` → `apps/studio` nav + route → `studio(key)` on the router.

RLS: `tenant_isolation` (`tenant_id = current_tenant() OR is_platform()`) on every tenant table, plus
`public_read` for published content (`kv_media.video_readable()`, SECURITY DEFINER). Platform mode is
`session.info["platform"]` → `app.platform='on'`. **A platform session must filter by tenant by hand**
(studio inbox and analytics do).

## Creator money (run 2)
- A creator sale is a `Checkout` in the **buyer's** tenant with `purpose` tip|boost|membership|video|series and
  `target.channel_tenant_id`; `support.fulfil()` grants, invoices (creator tenant, series `KVC`) and calls
  `splits.record_split()`, which posts the creator's books and holds Route transfers for `REFUND_WINDOW_DAYS`
  (reserve `MARKETPLACE_RESERVE_BPS` for `MARKETPLACE_RESERVE_DAYS`). `settle` posts the platform side.
- Selling needs an activated payout account (`splits.selling_problem`). Money only on hosted videos, never embeds
  (V04), India/INR only for now. Commission is `limits.commission_bps` on the creator's plan (placeholders 20/10/8%).
- Every revoke goes through `commerce/entitlements.revoke()` (S03). Refunds: `commerce/refunds.refund()` → revoke →
  credit note → reversal / `splits.on_refund()` (held transfers reversed; released money becomes a `recovery`
  netted from the next sale). A creator deleting a paid boost refunds it.
- Members-only and paid videos: `commerce/access` decides; locked viewers get a preview stream
  (`provider.preview`, sandbox truncates the playlists), transcript/captions/Ask/study answer 402, and search never
  returns transcript text from non-free videos.
- Tips carry no GST and no TCS; boosts, memberships and paid videos carry the creator's GST only if they gave a GSTIN.
  All rates are dated rows (`withholding_rates`, `PLATFORM` tax code) — "confirm with CA".

## Traps already found
- **Homebrew ffmpeg has no libass or drawtext.** Captions are drawn by Pillow into PNG frames and
  overlaid with a concat demuxer (`studio/render.py`). The Docker image's ffmpeg has both; keep the
  Pillow path anyway so dev and prod render the same.
- **MinIO images could not be pulled** here; dev uses the local storage adapter. S3 settings exist.
- **Sandbox STT reads the fixtures' embedded mov_text track** (`db-scripts/make_fixtures.py` builds
  them with `say` + ffmpeg). A video without one gets duration-based placeholder segments.
- **The sandbox embedder is hashed bag-of-words.** Search and Ask need lexical gating
  (`textkit.lexical()`, ≥2 content words, or ≥1 for short questions) or every query matches.
- **Ask's span check uses max(duration, last cue end)** — embeds can have `duration_ms = 0`.
- **The sandbox YouTube channel id is per tenant** (`UCkvSandboxChannel00001-t{tid}`) — a global id
  collided across suites.
- **`after_commit` ignores SAVEPOINT commits** (from Store) — keep it that way.
- **The signup rate limit exempts loopback only in sandbox**, or the suites hit 429.
- **Counters flush into `kv_social.view_daily` on the IST day of the flush**, not of the view.
- **Readiness refuses production with sandbox on** (`python -m app.readiness`).
- **nginx config is a template.** `infra/nginx/render.sh` runs `envsubst '${PUBLIC_DOMAIN}'` at container
  start; never commit a rendered `prod.conf`.
- **Mount `apps/web/dist` as a directory, never `dist/index.html` as a file.** A rebuild replaces the
  file and a single-file bind mount keeps pointing at the deleted one (share heads and deep links 404).
- **Anonymous home/reels feeds are cached in Redis for 15 s** (`kv:feed:*`); signed-in feeds are not.
- **Watch parties have no table** — state lives in Redis (`kv:party:{code}`, 6 h).
- **The studio's shared axios client defaults to JSON**; every multipart call passes `MULTIPART`
  (`apps/studio/src/lib/hooks.ts`) or the API answers 422.
- **axe counts `aria-hidden` text** when it checks that a control's name contains its visible text.
  Initials avatars draw their letters with `before:content-[attr(data-initials)]`; decorative duplicate
  thumbnail links are `aria-hidden` + `tabIndex={-1}`.
- **Status pill colours**: axe cannot read `color-mix()` text, so the studio passes dark hexes (`StatusChips.tsx`).
- Typecheck with `npx tsc --noEmit -p tsconfig.app.json` inside each app; the bare command checks zero files.
- **OpenCV 5 dropped `CascadeClassifier`** — `opencv-python-headless` is pinned to 4.14 for Haar face detection.
  The sandbox face detector tracks the magenta marker in `tests/fixtures/media/reframe-marker.mp4`.
- **A sandbox payment is processed just after `/sandbox/pay` returns** — tests wait for the checkout to read `paid`
  (`harness.support_pay`).
- **Bunny playback without `BUNNY_TOKEN_KEY` is a public URL** — paid and members-only videos need token auth on.
  Bunny has no preview stream (`preview()` returns None), so locked viewers see the paywall without a preview.
- `kv_ai.video_vectors`, `kv_ai.text_translations` and `kv_studio.music_tracks` have no `tenant_id` (shared,
  no RLS); everything else new is tenant-scoped, and product links, study sets, dub tracks and posts have
  `public_read` policies.
- Route needs `ROUTE_PROFILE_CATEGORY`/`SUBCATEGORY` (Razorpay's business category for Play) — empty means the live
  Route client refuses; confirm the category with Razorpay.
- The sandbox HLS ladder is 240p/360p/720p with 2-second segments (fast start); the speed suite measures video
  start on a 4G profile (`tests/e2e/speed.mjs`).
- The Expo app imports only `@klygenixvideo/client/src/native` (`tests/test_native_imports.py`); one
  react-native in node_modules. Expo SDK 58 / RN 0.88.1 / React 19.3.0 in `apps/mobile`; Metro pins `react` to
  `apps/mobile/node_modules`. RN 0.88 dropped the `ViewToken` type export — use a local structural type.
- **Live ingest needs the RTMP gate.** `ffmpeg -listen 1` accepts any app/stream name with only a warning, so a wrong
  key would go live. `live/gate.py` parses the AMF0 `publish` command on the public port, checks the key and only then
  forwards to ffmpeg on port+1000 (loopback). The gate holds back only a possible `publish` marker prefix — holding a
  fixed buffer deadlocks the RTMP handshake. Gates are always on per pool port; the encoder may connect before ffmpeg.
- **Never run a sync DB or Redis call on the event loop inside a WebSocket handler** (`asyncio.to_thread`). One did
  (`/ws/videos`): under load the empty pool blocked the whole worker for the 10 s pool timeout.
- **The API runs `WEB_CONCURRENCY` workers in production** (default 4). Request threads are capped at `DB_POOL_SIZE`
  (lifespan) so a request never waits on the pool; overflow is headroom for nested sessions. HTTP metrics are
  flushed to Redis (`kv:metrics:http:*`) so any worker answers `/metrics` with the same totals.
- **Live WebSockets fan out through `realtime/hub.py`** — one Redis pubsub per process, not one client per socket
  (per-socket clients ran out of fds at ~800). Raise `ulimit -n` (10240) before a local load test.
- **The live worker runs inline in dev** (`LIVE_WORKER_INLINE=true`); production and staging run it as the `live`
  service (compose profile `sandbox-live`, `make -C infra live`), never both — two supervisors would both finalize.
- **nginx must keep upstream connections alive.** Without `keepalive` every proxied request opened a new TCP connection
  and at ~900 req/s nginx ran out of local ports (`connect() failed (99: Address not available)`, 502s, every WebSocket
  failed). `prod.conf.template` uses `upstream kv_api { server backend:9300 resolve; keepalive 64; }` (needs nginx
  ≥ 1.27.3 for `resolve`; the image is `nginx:1.30-alpine`); `proxy-backend.conf` sets HTTP/1.1 and an empty
  `Connection` header except for WebSocket upgrades.
- **Dev and the local stack use different RTMP ports**: dev 19350–19359 (inline worker), staging 19450–19459
  (`LIVE_RTMP_PORTS` in `infra/.env.staging`, read by both the app and the compose port mapping).
- **Dates are IST**: invoices, credit notes, ledger business dates, number series and analytics windows use
  `app/video/clock.ist_today()`, never `date.today()` (containers run in UTC; 00:00–05:30 IST fell on the wrong day).
- **`tests/load/viewers.py` spreads viewers over `--procs` processes.** One Python event loop driving hundreds of
  viewers measures its own lag (600 ms "p95" while the server's histogram said 10 ms).
- `platform_session()` records audit rows as `system`/"background" unless given an `Actor`; platform admin routes
  set the admin as actor. A live chat timeout can target a `message_id` (user ids are not published).
- **Never run a migration while suites run against the dev API** — `apply_tenancy()` takes locks and deadlocked a
  running test (run 4). Stop, migrate, restart the API, then test.
- **Real adapters are tested with `tests/fakehttp.py`**: it swaps `httpx.request/get/post/put/patch/delete/stream` for a
  `MockTransport`, so adapters keep calling `httpx.*` directly. In-process suites use `TestClient(app,
  client=("127.0.0.1", 50000))` — the default "testclient" host is not loopback and hits the sign-up rate limit.
- A new ORM row's server/column default is not set until flush (`WaitlistEntry(...).status` is `None` before it) —
  set state fields explicitly when code branches on them before a flush.
- Cloudflare events must broadcast to the room **inside** the session after commit (detached instances raise).
- `kv_admin` tables (invite codes, waitlist, mail outbox, feedback) have no RLS by design (only platform code reads them);
  ads and sponsorship tables live in `kv_commerce` (tenant = the brand; creators read deals through a platform session
  filtered by `channel_tenant_id`). `kv_ai.reco_impressions` / `reco_models` are shared, no tenant.
- Ads: decisions mint a Redis impression token (3 h); counters `kv:ads:counts` are renamed and flushed by the sweep into
  `kv_commerce.ad_daily`; spend = impressions × CPM ÷ 1000 per campaign, capped at the budget; the API caches active
  campaigns for 15 s, so suites close leftover active campaigns first.
- Sponsorship money reuses `splits.record_split` (purpose `sponsorship`, commission override) and holds the creator's
  `sale` transfer ~10 years until approval sets `hold_until = now`; `release_due()` then releases it.
- Ad revenue share is a monthly Route **direct transfer** (`route.direct_transfer`, `RouteTransfer.kind = 'ad_share'`).
- `SIGNUP_MODE` (open|invite|closed) overrides the legacy `SIGNUP_ENABLED`; `CREATOR_SIGNUP` gates opening a channel.
  Product mail goes through `core/services/mailer.py` (`EMAIL_PROVIDER=sandbox` captures to the outbox).

## Dev accounts
`admin@klygenix.com` / `admin123` — global admin (admin console, tenant 1 = Klygenix's own channel
`klygenix`). Demo (after `seed-demo.py`): creators `asha@` and `meera@demo.klygenix.com`, viewers
`rohan@` (Premium) and `sara@`, password `Welcome@12345`. Suites make their own `suite-*@example.com`.

## Commands
```bash
docker compose -f infra/docker-compose.dev.yml up -d
cd backend && ./venv/bin/alembic upgrade head && ./venv/bin/uvicorn app.main:app --reload --port 9300
npm run dev:web | dev:studio | dev:admin | dev:tv | dev:mobile
python3 db-scripts/make_fixtures.py && backend/venv/bin/python db-scripts/seed-demo.py
make -C infra test                              # every suite; CI runs them twice
db-scripts/dump-schema.sh && (cd tests && ../backend/venv/bin/python test_migration_parity.py)
bash infra/local-stack.sh up && bash infra/local-stack.sh smoke   # production stack on play.localhost:8443
```
`JOBS_MODE=inline` (dev default) runs jobs in-process; `rq` needs `make -C infra worker-ai worker-render scheduler`
(and `make -C infra live` with `LIVE_WORKER_INLINE=false`).
`VPS_HOST=… bash infra/deploy.sh --rollback` restores the previous image and frontends (one step back).
`make -C infra providers-check ENV_FILE=../backend/.env.prod` before switching a provider on (`docs/GO-LIVE.md`).
- **Ads bill on `q0`, not `start`**: an impression is billable only when the player reports 2 s of play (`q0`) at least
  ~2 s after `start`, from the same viewer key, outside data-centre ranges and bursts. Test and smoke clients send a browser
  User-Agent — httpx's default UA is a bot and gets no ad.
- **Romanised search**: `kv_media.videos.roman` / `kv_ai.segments.roman` hold a Devanagari→Latin, phonetically normalised
  form (`video/services/translit.py`, schwa deletion, vowel folding) kept current by ORM listeners installed when
  `app.video.models` is imported; `search_roman` tsvectors and a `pg_trgm` fallback make Hinglish, Devanagari and typos
  meet. Raw SQL inserts bypass the listeners — set `roman` yourself.
- `kv_commerce.route_transfers.kind` is `String(10)`; a longer kind is reported as a 422 ("out of range") by the DataError
  mapping, not a 500.
- Regions: `REGION` (in|us), accounts carry `home_region` from their country; with `REGION_ENFORCE` the other host refuses
  sign-up and sign-in with a link (`/api/auth/region` for discovery). A second local stack: `KV_STACK=staging-us bash
  infra/local-stack.sh up --skip-web` (container names and env file follow `KV_STACK`).
- In-app notifications are written for every push (`services/push.notify` → `services/inbox.add`) plus new videos from
  followed channels, comment replies and deal events; the digest sweep runs at 08:00 IST (weekly on Mondays by default).
- Downloads are licences, not DRM: `POST /videos/{id}/download` returns a 6-hour MP4 link and a 30-day signed licence the
  app re-checks (`/me/downloads/check`) — Premium lapsing or the video being removed withdraws it.

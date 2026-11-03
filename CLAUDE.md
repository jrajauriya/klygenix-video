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
V0 + V1 (run 1) and V2 Earn + V3 Community & learning (run 2) built and running **locally on sandbox
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
| apps/mobile (Metro) | 8082 | — | iOS / Android (Expo) |
| API (+ WebSocket) | 9300 | — | api.play.klygenix.com |
| PostgreSQL 17 + pgvector | 25436 | — | 127.0.0.1:5432 |
| Redis | 16383 | — | compose network |

Clear of the estate (4000s/9000/25432/16379), Pay (5000s/9100/25433/16380), Store (5100s/9150/25434/16381)
and Insurance (25435).

## Structure
```
backend/app/
├── main.py, config.py        every setting has a dev default; sandbox providers by default
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
    ├── realtime/rooms.py     WebSocket rooms over Redis pub/sub (stateless gateway)
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
    ├── jobs/                 RQ queues ai / render / default · scheduler · sweeps
    └── sessions.py           tenant_session() / platform_session()
packages/  ui auth client types config fonts observe (from Store) · player (hls.js, DanmakuLayer, ChapterBar, YouTube/Bilibili embeds, DanmakuRail)
apps/      web (viewer) · studio (creator) · admin (platform) · mobile (Expo: Feed, Watch, Create, Profile)
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
  react-native in node_modules; React pinned to 19.2.3 in `apps/mobile`.

## Dev accounts
`admin@klygenix.com` / `admin123` — global admin (admin console, tenant 1 = Klygenix's own channel
`klygenix`). Demo (after `seed-demo.py`): creators `asha@` and `meera@demo.klygenix.com`, viewers
`rohan@` (Premium) and `sara@`, password `Welcome@12345`. Suites make their own `suite-*@example.com`.

## Commands
```bash
docker compose -f infra/docker-compose.dev.yml up -d
cd backend && ./venv/bin/alembic upgrade head && ./venv/bin/uvicorn app.main:app --reload --port 9300
npm run dev:web | dev:studio | dev:admin | dev:mobile
python3 db-scripts/make_fixtures.py && backend/venv/bin/python db-scripts/seed-demo.py
make -C infra test                              # every suite; CI runs them twice
db-scripts/dump-schema.sh && (cd tests && ../backend/venv/bin/python test_migration_parity.py)
bash infra/local-stack.sh up && bash infra/local-stack.sh smoke   # production stack on play.localhost:8443
```
`JOBS_MODE=inline` (dev default) runs jobs in-process; `rq` needs `make -C infra worker-ai worker-render scheduler`.

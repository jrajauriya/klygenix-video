# Klygenix Play — build plan and status

The master plan (`../Klygenix_Docs/Klygenix_Video/klygenix-video-master-plan.html`) says what and
why; this file says what is built, what each test proves, what runs only on sandbox providers and
what is blocked. Built in unattended runs, 3–9 Nov 2026 (run 10 newest, below). **Run 10 is not committed** (the owner
commits by hand; runs 1–9 are) **and production is not deployed yet** (the Play VPS is set up; see `docs/DEPLOY-PLAN.md`).

**Done means:** `npx tsc --noEmit -p tsconfig.app.json` and `vite build` pass for every app it touches;
`alembic upgrade head` + `alembic check` clean; `db-scripts/dump-schema.sh` re-run and parity green;
its suites green **twice over one database**; CLAUDE.md updated.

## Phases

| Phase | Scope | Status | Proven by |
|---|---|---|---|
| 0 Fork & Docker | Store forked and renamed (`kv_*`, `@klygenixvideo/*`, ports 9300/25436/16383, 5300–5312); pgvector Postgres 17 + Redis in Docker; fresh Alembic baseline (4 revisions) with RLS, public-read policies, app role | Done | `test_migration_parity.py` |
| 1 Accounts & gates | Sign-up with DOB, country, language; server age gate (18 IN / 16 some EU / 13); personal tenant; channel; `video.*` features and roles | Done | `test_accounts.py`, `test_tenancy.py` |
| 2 Media pipeline | Provider interface; sandbox provider (PUT upload, ffmpeg HLS 360p/720p, thumbnail, signed webhook, HMAC playback); Bunny adapter (TUS signature, token HLS, webhooks); reel vs long by aspect + length; visibility incl. scheduled | Done (Bunny untested live) | `test_upload_flow.py` |
| 3 AI | STT (sandbox / Azure / OpenAI); insights (summary, chapters, key points, tags, title ideas, hashtags); embeddings (pgvector, HNSW); hybrid search; Ask with citation guard; caption translation on request; clip finder; quotas reserve/commit/release; LLM budget + costs | Done (sandbox models) | `test_ai_pipeline.py`, `test_search.py`, `test_ask_citations.py`, `test_quota.py` |
| 4 Social & realtime | Follow, like, threaded comments, danmaku (buckets, modes, colours, filter in six languages, rate limits, 3 reports hide), WebSocket rooms over Redis, Redis counters flushed by the scheduler, feed ranking v1, history | Done | `test_social.py` |
| 5 Studio & render | Clips from suggestions or a range; 9:16 center/manual reframe; three caption styles (Pillow frames, karaoke); free-plan watermark; render → new reel or MP4 download | Done (no face tracking — see below) | `test_clips.py` |
| 6 Plans & billing | 5 plans; checkout priced by the server; sandbox / Razorpay / Lemon Squeezy rails; payments worker grants; GST invoice series `PLY`; ledger in the admin tenant; lapse; cancel | Done (real rails untested live) | `test_plans_billing.py` |
| 7 Trust & safety | Scanner interface (sandbox markers + hash list); scanning → published / in_review / blocked; reports; moderator actions; strikes (3 → suspend); appeals; takedowns with IT-Rules clocks; rights + AI declarations | Done (no real vendor) | `test_moderation.py` |
| 8 YouTube | OAuth connect (sandbox fake channel), own videos as embeds, owner captions into the pipeline; creator SRT/VTT for YouTube/Bilibili links; no download path; nothing over the player | Done (Google OAuth untested live) | `test_embed_policy.py` |
| 9 Web | `packages/player` (hls.js, DanmakuLayer, ChapterBar, transcript, YouTube/Bilibili embeds + DanmakuRail); home, reels, watch (chapters, summary, transcript, Ask, danmaku, comments, up next), search, channel, plans + sandbox checkout, account (history, privacy & data), sign-in/up with age gate, legal pages, server-rendered share heads | Done | tsc + build; clicked in Chrome; `tests/e2e` |
| 10 Studio & admin | Studio: dashboard, videos, upload drawer (PUT/TUS with progress), video detail (details + AI drafts, transcript, captions, clips, comments, analytics), clip editor, channel, comments & danmaku inbox, analytics with daily chart, billing, moderation, settings. Admin: Store's console plus moderation, reports, takedowns, strikes/appeals, AI usage and cost, platform stats | Done | tsc + build; clicked in Chrome; `tests/e2e` |
| 11 Mobile | Expo SDK 57: Feed (reels, expo-video), Watch (player, chapters, Ask, danmaku), Create (pick/record, trim points as data, upload, clip ideas, render, publish), Profile; push token registration (no-op without an EAS id) | Done (no store build) | `npx tsc --noEmit`; `expo export` iOS + Android; `test_native_imports.py` |
| 12 Prod stack, infra, CI | `docker-compose.prod.yml` (backend ×`WEB_CONCURRENCY`, worker-ai, worker-render, scheduler, nginx from a `${PUBLIC_DOMAIN}` template); staging overlay + `local-stack.sh`; `deploy.sh`; Prometheus alerts incl. pipeline/render/AI/LLM budget/takedowns; CI (web/studio/admin matrix, mobile, pgvector backend ×2, e2e, security) | Done locally | `local-stack.sh up` + `smoke`; `monitoring.sh check`; scans (docs/SECURITY.md) |
| 13 Verification & docs | Suites ×2, parity, e2e, load test, docs (this file, LAUNCH, PROVIDERS, SECURITY, README, CLAUDE.md), plan HTML updated | See results below | — |
| 14 Stretch | Playlists and series with progress (V1.7 / V3.1); watch parties with a shared playhead and chat (V3.7); AI thumbnail ideas + custom thumbnails shown (V1.3); data export / erasure; studio analytics with daily series; comment inbox with hide/unhide | Done | `test_playlists.py`, `test_parties.py`, `test_thumbnails.py`, `test_viewer_extras.py` |
| 14 not started | Tips, boost danmaku, channel memberships, paid videos (V2.2–V2.5) | Waiting | They pay creators: rule S11 needs Razorpay Route linked accounts and creator KYC (V2.1), not forked yet |

## Run 10 — deploy prep on the Play VPS (9 Nov 2026)

The owner bought a third Hostinger KVM 4 for Play only and asked for the deploy. Choices and progress live in
`docs/DEPLOY-PLAN.md`; this section records the code.

| | What | Proof |
|---|---|---|
| R10.1 | **Upload scan on Azure AI Content Safety** (`SCAN_PROVIDER=azure_content_safety`): title, description, transcript (≤10,000 chars) and 6 frames grabbed by ffmpeg; any category ≥4 → moderation queue, Sexual ≥6 → blocked; the local hash list still runs first. Readiness accepts it; `providers_check --live` sends one text call | contract tests (frames, caps, verdicts, refusals); live probe ok on `aif-klydo-platform` |
| R10.2 | **Live menu hidden while live is off** (`live.service.available()`; `/tenant-features` turns `video.live` off; the studio nav checks it for team members too) | contract tests |
| R10.3 | **Azure speech retries 429/503** (`Retry-After`, else 2/4/8/16 s) — the first live call hit "Resource Exhausted" | contract tests |
| R10.4 | **`providers_check --env-file … --live` probed the dev settings**, not the file's; Route keys no longer skip the Razorpay probe | live probes against `play.env.prod`: LLM, Content Safety, Razorpay ok |
| R10.5 | **Flat hosts** (`HOST_STYLE=flat`: `play-studio.klygenix.com`, like Store/Insurance) from one helper: `infra/nginx/hosts.sh` (nginx, `build-web.sh`), `Settings.public_host()` (readiness, providers check, activity log), `EXPO_PUBLIC_HOST_STYLE` (app links). Nested stays the local default | `test_nginx_conf.py` (helper both ways, no hand-built host, render) · `test_app_links.py` · real nginx image renders and `nginx -t` passes both ways |
| R10.6 | **Production build fixed**: `deploy.sh` now builds every app through `build-web.sh` with the prod `infra/.env` — a bare `npm run build` gave the TV app no API URL and left the web app's studio link on `localhost:5301` | prod bundles: every app on `play-api.klygenix.com`, no `localhost` |
| R10.7 | **`deploy.sh` never uploaded `applinks.sh`** (or now `hosts.sh`) although nginx runs them at start — the first production nginx would not have started | `test_nginx_conf.py`: every script nginx mounts is uploaded |
| R10.8 | `infra/server-setup.sh` (Store's, Play's paths) | run on the VPS |
| R10.10 | **The Cloudflare-only firewall dropped containers' own outbound HTTP/HTTPS**: replies to a container's request to port 80/443 come back on `eth0` with that original port and hit the DROP, so `docker build` could not reach `deb.debian.org`. The DOCKER-USER rules now match `--ctdir ORIGINAL` (only connections started from outside). Store's script has the same rules (read-only here — the owner should check Store's server) | on the VPS: a container fetches over HTTP; direct-IP 80/443 still refused |
| R10.11 | **The post-deploy smoke test built nested sibling hosts** (`api.<base>`), so against production it would have checked `api.play.klygenix.com`. `--host-style auto|flat|nested` (auto: nested only for `*.localhost`); the printed production smoke command and `LAUNCH.md` add `--skip-live` (live is off) | rehearsal below |
| R10.12 | **Rehearsal on the Play VPS** (staging target, sandbox providers, flat hosts on `play.localtest.me` through an SSH tunnel to nginx on 127.0.0.1:9443): readiness 0 blocking; smoke **161 passed, 0 failed** (live skipped); `seed-demo.py` published five videos through the server's pipeline; load 100 viewers + 200 WebSockets for 60 s: **0 errors, 200/200 sockets**, server-side `feed/home` 96% under 50 ms (client p95 is the 270 ms tunnel round trip). Production `--dry-run` clean. The rehearsal stack (`klygenix-video-staging`) is still up on loopback; tear it down before the production deploy | done |
| R10.13 | **Bunny webhook status map was wrong**: `6` is "pre-signed upload started" (not failed), so every TUS upload was marked failed the moment it began; `4` ("one resolution finished") arrived before the MP4 fallback the pipeline reads. Now `3` → encoded, `5`/`8` → failed (with Bunny's `Reason`), 4/6/7 ignored; Bunny's `EventId` keys the event so redeliveries drop (statuses from bunny.net/docs/stream-webhook) | contract tests (4/6/7 progress, 8 failed with reason, EventId) |
| R10.14 | **The webhook secret was written to the access log** (`?secret=` in uvicorn's request line). `JsonFormatter` now masks `secret`/`token`/`key`/`signature`/`code` query values in every message | formatter check; server containers recreated |
| R10.15 | **`creator_money` sweep failed every cycle with Route off** (`release_due` built the Route client before looking for due transfers, and the failure skipped payouts and statements too). It now returns early when nothing is due | production worker log |
| R10.16 | `deploy.sh` never uploaded `backup-ship.sh` (nightly off-host ship would fail) or `pitr-rehearse.sh`; the PITR rehearsal still counted Store's `kv_commerce.orders` and `ks_*` schemas (passed on 0 tables) — now `checkouts` and `kv_*`; it and BACKUPS.md now use the `pgvector/pgvector:pg17` image (plain `postgres:17` has no `vector` extension) | on the VPS: first base + logical backup shipped to R2 (5/5 verified); PITR 9/9 with 106 tables |
| R10.17 | Web footer floated mid-screen on short pages: the layout is a full-height column and `main` fills it | tsc |
| R10.18 | Cloudflare's zone browser-cache TTL (4 h) rewrote `/sw.js`'s `no-cache`; a Cache Rule "Play service worker never cached" bypasses cache and respects origin TTL for `/sw.js` on the four Play app hosts only (other zone hosts untouched) | `curl -I https://play.klygenix.com/sw.js` → `no-cache` |
| R10.19 | **Azure fast transcription refuses `hi-IN` in Central US** (`429 Resource Exhausted` on every Hindi request, English fine on the same audio and key). When a non-English locale is refused after the retries, Play retries once with auto-detect: Hindi videos get a romanised (Hinglish) transcript, which romanised search already matches against Devanagari queries. Devanagari transcripts need `hi-IN` from another region or a transcribe model (owner decision) | contract tests (refused Hindi → auto, English never retried as auto); live repro from the Mac |
| R10.20 | **Legal pages read Klygenix's facts from the admin**: public `GET /api/video/company` (admin tenant name, address, GSTIN, CIN, emails, grievance officer; 5-min cache) fills CIN, address, GSTIN, contact emails and the grievance officer wherever they appear. Filled from the deployment: safety vendor (Azure AI Content Safety), backups (Cloudflare R2, APAC), provider regions. New **Refunds & cancellations** and **Contact us** pages (Razorpay's website review asks for both), in the footer and the legal nav. Policy decisions stay yellow placeholders and the draft banner stays until legal review | tsc |
| R10.21 | **No admin screen could set Klygenix's identity**: Accounts → Details edited only the name, and `settings.grievance_officer` (a readiness BLOCK with `--db`) had no API at all. New **Company** tab (address, city, state, PIN, GSTIN with format check, support email, phone; on the admin account also CIN, privacy/legal emails, grievance officer), `TenantUpdate.legal` merged into `settings` (only those keys) | `test_admin_ops`: saved, published by `/api/video/company`, other settings kept, nothing private published · `test_security` allow-list |
| R10.22 | **Reprocess never re-transcribed**: a video whose speech step failed was published with no transcript and "Reprocess" only re-ran insights. `reanalyse` now fetches and transcribes a hosted video that has no cues (no new quota — the minutes were reserved on the first run) | production: the Hindi test video got its Devanagari transcript; Ask answers in Hindi with a citation |
| R10.23 | `tests/load/viewers.py`: `--videos` for a fresh server with empty feeds; `wss://` got `ssl=None` without `--insecure` (every socket failed) — now a verifying context from `certifi` | production through Cloudflare: 200/200 sockets |
| R10.24 | **Legal pages final (11 Nov 2026)**: owner's choices filled every placeholder and the draft banner is gone — plan refund within 7 days of the first payment, 30 days' notice, Pune courts (no arbitration), liability ₹1,000, TCS 0.5% / TDS 0.1% (5% without PAN, tips excluded), replies 3 working days / privacy 30 days, tax records 8 years, logs 180 days, counter-notice 14 days, payouts 18+, live children under 16 with an adult, brand ads (no profiling, Premium ad-free), error reports only. Monetisation text corrected: creators do get an ad-revenue share. **Open**: the Terms promise live on Creator Pro/Business only — restrict `video.live` to those plans before switching live on | prod |
| R10.9 | `test_moderation` read only the first queue page; 50 open reports from old runs pushed the new one to page 2 | pages through `X-Total-Count` |
| open | `test_analytics_reco` "the feed moves toward what was watched" fails on the long-lived dev database after many runs (a new user's top five already carries earlier runs' dal-tadka copies; before = after = 0.519). Feed code untouched in run 10; CI's fresh database is unaffected. Fix: give the suite a unique topic or reset the dev DB | logged, not changed |

## Run 9 — live sockets under HTTP load (5 Nov 2026)
Run 8 committed by the owner as `1f8e34d`. Every item still open in the plan HTML waits on an account, the CA, a lawyer, a VPS or
a vendor; the one developer item left was "Sockets under HTTP load" (RED in run 8). The owner chose to re-measure it. Nothing
committed, nothing deployed.

| Item | Scope | Status | Proven by |
|---|---|---|---|
| R9.1 Sockets under HTTP load | Found a real bug, not machine noise: a WebSocket upgrade that nginx sends on a just-freed pooled upstream connection is closed by uvicorn 5 s later. `/api/video/ws/` on the api and web hosts now goes to `upstream kv_ws` (no `keepalive`); HTTP keeps its pool | Done | load 200/200 ×3 (was 199, 199, 199, 196, 196 on the same quiet machine); `test_nginx_conf` 11 (in `make test` and CI) |

### How it was found
- On a quiet machine the mixed run was GREEN but lost **exactly one** socket each time (199/200 ×3, as in run 7) — too regular for
  noise. An instrumented copy of `viewers.py` showed every dropped socket ending ~5 s after it opened, in the same second across
  processes and rooms; sockets alone held 200/200; nginx logged the drops at that second, the backend logged nothing.
- 5 s is uvicorn's `--timeout-keep-alive`. uvicorn arms that timer in `on_response_complete`, i.e. when the request's ASGI task
  finishes (after the metrics / activity / tracing middleware), a few ms after the response bytes left. nginx (upstream `keepalive 64`,
  the run 3 fix) gets the full response, pools the connection and, under load, sends the next request — a WebSocket upgrade — on it
  at once. uvicorn switches the transport to the WebSocket protocol, then the old HTTP handler's task finishes and arms the timer,
  which closes the shared transport 5 s later without a close frame.
- Reproduced deterministically against uvicorn directly (raw sockets, dev API): upgrade on a reused keep-alive connection right after
  the response → **40/40 closed at 5 s**; 5 ms later → 1/40; 50 ms → 0/40; on a fresh connection → 60/60 held. Through nginx at low
  load it never hit (the pool hands connections back well after the window), which is why only 1–4 of 200 dropped under load and
  3–7 with a video call slowing the event loop. In production with real traffic every live chat / danmaku socket was exposed.

### Run 9 results
| Check | Result |
|---|---|
| Load before the fix (quiet machine) | 1,129–1,177 req/s, 0 HTTP errors; sockets **199, 199, 199, 196, 196 / 200**, every drop ~5 s after open |
| Load after the fix | **1,174–1,178 req/s, 0 HTTP errors, p95 ≤ 46 ms (danmaku post; reads lower), sockets 200/200 ×3 — GREEN**; 200 sockets alone 200/200 |
| Idle sockets through nginx | web host and api host each held 75 s idle and answered `ping` |
| Suites, run twice over one database | **50 suites × 1,529 checks, 0 failed — twice** (new `test_nginx_conf` 11) |
| Stack | nginx re-rendered, `nginx -t` OK; smoke **170/0** · CSP 36/0 |
| Scans | gitleaks 0 · semgrep 0 (262 rules) |

### Changes
- `infra/nginx/prod.conf.template`: `upstream kv_ws` (no keepalive) and `map $host $kv_ws_backend`; `/api/video/ws/` on the api host
  uses it; the web host gets its own `/api/video/ws/` location (same-origin sockets from the web app's fallback) with the hour-long
  timeouts.
- `tests/test_nginx_conf.py` (new, `make test` + CI backend job): HTTP upstream keeps `keepalive 64`; the WebSocket upstream has none;
  every host that proxies the API sends `/api/video/ws/` to it with the upgrade headers and hour-long timeouts. Fails on `1f8e34d`.
- `tests/load/viewers.py`: each "socket ended" reason says how many seconds of the run were left.

### Decisions taken in run 9
- Fixed in nginx, not uvicorn: the race is inside uvicorn's HTTP protocol (keep-alive armed after the app task, not after the write),
  and browsers never upgrade on a reused HTTP connection — only a pooling proxy does. Raising `--timeout-keep-alive` would only delay
  the close.
- Not reported upstream from here (no outside posting without the owner); the raw-socket reproduction is in this section if the owner
  wants to file it with uvicorn.

### Still open after run 9
| Item | Needs |
|---|---|
| Everything that needs others | accounts, CA, lawyer, VPS; the 500-viewer target on the VPS |
| App links live | the Apple Team ID and the Play signing fingerprint (`docs/GO-LIVE.md` "Run 8"), then a device check |
| Native TV wrappers (V5.3) | store accounts and devices (no Android SDK on this machine) |

## Run 8 — channel notices for members, app links, frontend majors (4 Nov 2026)

Runs 6 and 7 committed by the owner as `1feb57e`. Every item still open in the plan HTML waits on an account, the CA, a lawyer,
a VPS or a vendor; the owner chose the three developer items left after run 7, overnight, no stops. Nothing committed, nothing
deployed.

| Item | Scope | Status | Proven by |
|---|---|---|---|
| R8.1 Channel notices | `/me/moderation`, `/appeals`, `/me/takedowns` and the counter-notice use `deps.notices(level)`: owner unchanged, a team member through `X-Kv-Tenant` at `video.comments` view (appeal at full); the counter-notice is owner-only (403 `owner_only`, `can_counter` false for members); the studio's Moderation page shows members the channel's notices and hides Appeal without full access | Done | `test_teams` 61 (moderator reads and appeals, editor reads but cannot appeal, forged header 403, member counter-notice 403, removed member 403) |
| R8.2 App links | `infra/nginx/applinks.sh` writes `apple-app-site-association` / `assetlinks.json` at nginx start from `APPLE_TEAM_ID` / `ANDROID_CERT_SHA256` (validated; empty or malformed → 404), served on the web and studio hosts; `apps/mobile/app.config.ts` adds associated domains and verified intent filters for `EXPO_PUBLIC_DOMAIN`; `lib/links.ts` + `app/+native-intent.tsx` map `/watch`, `/reels`, `/live`, `/@handle` and `/team/accept?token=` to screens, anything else to the feed | Done (real Team ID and fingerprint wait for the store accounts) | `test_app_links` 24 (in `make test` and CI); stack smoke (well-known files); `expo export` iOS + Android |
| R8.3 Frontend majors | web, studio, admin, tv: Vite 6 → 8.3 (Rolldown), plugin-react 4 → 6.2, TypeScript 5.9 → 7.0, Sonner 1 → 2, lucide 0.468 → 1.68, tailwind-merge 2 → 3.7; Recharts removed (declared, never imported). Mobile stays on Expo SDK 58's TypeScript 6 | Done | tsc + `tsc -b` + build for every app; e2e screens 322/0, axe 141/0, speed 14/0 (watch JS 413 → 405 KB) |

### Run 8 results
| Check | Result |
|---|---|
| Suites, run twice over one database | **49 suites × 1,518 checks, 0 failed — twice** (after the subscriptions fix; the first double run was 1,518/0 then 1 failure in pass 2, see bugs); `alembic check` clean; parity 6/6 |
| e2e on the new toolchain | screens 322/0 · axe 141/0 · speed 14/0 — watch LCP 1.64 s, video start 1.67 s, watch JS 405 KB (was 413), home JS 177 KB |
| Bundles (gzip, all JS) | web 512 → 494 KB · studio 556 → 534 KB · admin 231 → 220 KB · tv 356 → 339 KB |
| Mobile | `tsc` clean; `expo export` iOS 3.3 MB / Android 3.7 MB; `expo config` carries the associated domains |
| Stack | rebuilt; smoke **170/0** (four new app-link checks) · CSP 36/0 · both well-known files served as JSON on web and studio with test values, 404 without · load 100 viewers + 200 sockets: **1,070–1,120 req/s, 0 HTTP errors, p95 ≤ 45 ms**, sockets 193–197/200 (RED by the 1 % rule) — a video call was using the same Mac's CPU during the run; the dropped sockets closed without a close frame mid-run (now reported by `viewers.py`), and 200 sockets alone held 200/200 GREEN. No realtime, socket or proxy code changed in run 8 (run 7: 199/200 on a quiet machine) |
| Scans | gitleaks 0 · semgrep 0 (262 rules, 814 files) · bandit 0 medium+ · pip-audit 0 · npm: only the documented Expo-toolchain findings (mobile) |

### Bugs found and fixed in run 8
- **Subscriptions "new" marker** (`/feed/subscriptions`): the last-seen time was stored in whole seconds, so a video published in
  the same second as a visit stayed "new" after it (pass 2 of the first double run). Stored with microseconds and never earlier
  than the newest video shown; `test_viewer_growth` 5/5 after.
- lucide 1 removed brand icons; the studio's YouTube / Instagram glyphs are local (`components/BrandIcons.tsx`).
- `npm install` kept a hoisted Vite 6 for `@tailwindcss/vite`; `npm dedupe` left one Vite 8.

### Decisions taken in run 8
- Notices reuse the `video.comments` key (manager and moderator full, editor and analyst view) instead of a new feature key, so
  no plan or matrix migration was needed.
- TypeScript 7 kept (every app and package typechecks and builds); `baseUrl` dropped from each `tsconfig.app.json`.
- App links are configured on nginx, not the API: the files are static and must answer without the backend.

### Still open after run 8
| Item | Needs |
|---|---|
| Everything that needs others | accounts, CA, lawyer, VPS; the 500-viewer target on the VPS |
| App links live | the Apple Team ID and the Play signing fingerprint (`docs/GO-LIVE.md` "Run 8"), then a device check |
| Native TV wrappers (V5.3) | store accounts and devices |
| Sockets under HTTP load | re-measure 100 viewers + 200 sockets on a quiet machine or the VPS; if drops persist, look at the nginx ↔ uvicorn WebSocket path under CPU pressure |

## Run 7 — run 6 follow-ups, overnight while the owner slept (4 Nov 2026)

The owner asked to keep going with whatever was still open on the developer side after run 6. Nothing committed, nothing
deployed; run 6 and run 7 sit together in the working tree.

| Item | Scope | Status | Proven by |
|---|---|---|---|
| R7.1 Error codes, account mails | every `err()` refusal carries `code` in the body and `X-Error-Code` (exposed via CORS); verify / reset / invite links go through the mailer (`account_*`, EN/HI) so sandbox captures them and SMTP/Graph deliver them | Done | `test_teams` (codes), `test_support_desk` 21 (verify and reset mails in the outbox) |
| R7.2 Team mode finished | `/studio/team/me` returns the channel owner's plan and meters (and a full permission map for the owner); the dashboard checklist hides money and channel set-up from members; studio uses the owner's plan/meters and the `code` for fallback; view-only screens hide or disable what the API would refuse; team moderators can delete comments/danmaku and moderate live chat (`teams.can_act`); the invite preview answers 410 when expired; invitees with an account get an inbox notice; mobile: invite accept screen (deep link or pasted link), leave channel, the owner's plan on Create; accessible role matrix in `packages/ui` (named cells, readable hints, a role picker under `sm`) | Done | `test_teams` 48, studio clicked through by the agent, mobile tsc + `expo export` |
| R7.3 Throughput | channel counters fetched once per page instead of once per card; counter reads without MULTI/EXEC — home feed build 14.8 → 11.5 ms; deferring wide columns tried and reverted (no gain) | Done | load at 100 viewers: p95 watch 22 ms (was 32), home feed 10.5 ms (was 16.1) |
| R7.4 FastAPI 0.141.1 → 0.162.0 | Starlette 1.10 and Pydantic 2.14 unchanged | Done | both full passes on 0.162 |

### Run 7 results
| Check | Result |
|---|---|
| API suites, **twice over one database** | **48 suites, 1,469 checks per pass, 0 failed both passes** (on FastAPI 0.162) |
| Browser (`node tests/e2e/run.mjs`) | screens **322/0**, axe **141/0**, speed **14/0** (watch video start 1.61 s, reels 1.59 s; JS home 176 / reels 391 / watch 413 KB of 420) |
| Mobile | tsc and `expo export` iOS + Android (agent); native imports green in both passes |
| Production stack (rebuilt) | **smoke 166/0**, **CSP 36/0** |
| Load, 100 viewers + 200 sockets | **1,179 req/s, 0 errors, p95 ≤ 22 ms**; 197/200 sockets in the load script — a separate 200-socket probe during the same HTTP load opened and held all 200, so the failures were the load generator's own event loop; `tests/load/viewers.py` now runs its sockets in processes of their own — rerun: 1,171 req/s, p95 ≤ 21 ms, 199/200 sockets, GREEN |
| Live, 1,000 watchers on an ffmpeg-fed stream | **1,000/1,000 connected, 55,000/55,000 deliveries, p95 76 ms**, HLS p95 74 ms, 0 errors |
| Security | gitleaks pass · bandit 0 · semgrep 0 (262 rules, 808 files) · pip-audit 0 (FastAPI 0.162 included) · npm: the documented mobile-only findings |

### Still open after run 7
| Item | Needs |
|---|---|
| Everything from run 6 that needs others | accounts, CA, lawyer, VPS; the 500-viewer target on the VPS |
| Universal / App Links for invites | `associatedDomains` and Android `intentFilters` in app.json plus `apple-app-site-association` / `assetlinks.json` on the web host (owner, with the store accounts) |
| Channel notices for members | `/me/moderation`, `/appeals`, `/me/takedowns` read the member's own tenant; the studio shows members an owner-only note there (the other screens — Community, Calendar, sponsorships, brand, Settings — are gated, e2e 322/0 and axe 141/0 after the change) |
| Frontend majors | Vite 8, TypeScript 7, Recharts 3, Sonner 2, lucide 1, tailwind-merge 3, plugin-react 6 — a run of their own |

## Run 6 — run 5 gaps, channel teams, creator onboarding & admin support, scale & ops (4 Nov 2026)

Owner's choice: all four developer-side tracks, overnight, no stops. Every V0–V5 roadmap item is done or waits on an
account, the CA, the lawyer or a VPS, so this run is "beyond the roadmap" (R6.1–R6.4 in the plan HTML). Runs 1–5 committed
(`d95dd50`, `cccf074`, `57d79d6`, `d1ba83c`, `85cf632`). Baseline on the clean tree: 44 suites, 1,344 checks, 0 failed.
**Nothing committed, nothing deployed.**

| Phase | Scope | Status | Proven by |
|---|---|---|---|
| 1 Run 5 gaps + flake | "Paid partnership with {brand}" from the message catalogue (Hindi, and the anonymous feed cache is now per language); `/admin/ads/ivt?from&to` from daily Redis reason counters (400 days) and `ad_daily`; chapter history keeps each version's chapters and restores one as a new version; every repurpose pack listed and openable; notifications carry `app` (viewer / studio) and the bells filter by it; `test_analytics_reco` fixed | Done | `test_ads` 76, `test_sponsorships` 42, `test_creator_ai` 37, `test_viewer_growth` 34; reco suite 5 runs in a row green |
| 2 Channel teams | `kv_admin.tenant_members`, invitations by mail (hashed single-use token, 7 days, email-bound), roles manager / editor / moderator / analyst in the channel's own matrix, acting channel by `X-Kv-Tenant` in `deps.studio()`, billing and earnings owner-only, plan seat limits (placeholders 1 / 5 / 25), leave, audit as "member X in channel Y"; studio Team settings, accept page and channel switcher; mobile Create-tab channel picker | Done | `test_teams` 42 |
| 3 Onboarding & support | bulk YouTube import with per-video progress, resume and no duplicates; handle rename (once per 30 days) with old handles reserved and redirecting for 180 days (API lookups and a 301 from share heads); onboarding mails day 0 / 2 / 7 (EN/HI, skipped once done, opt-out); admin support desk: lookup by email / handle / id / payment, account timeline, sign out everywhere, resend verification, refund from a purchase, read-only support sessions | Done | `test_onboarding` 27, `test_support_desk` 19 |
| 4 Scale & ops | `reco_impressions` and `activity_log` range-partitioned by month (`kv_admin.maintain_partitions()`, SECURITY DEFINER, run by the retention sweep; old months dropped); tracing (request, job and LLM spans, W3C `traceparent`, OTLP/JSON export, off by default); `pg_stat_statements` + `make -C infra slow-queries`; backend patch/minor upgrades (SQLAlchemy 2.1.8, Alembic 1.20.1, psycopg 3.3.7, cryptography 50.0.2, sentry-sdk 2.73.0 and 7 more) | Done | `test_retention` 14, `test_tracing` 13, `test_migration_parity` |
| 5 Frontends | studio, admin + web, mobile by three parallel agents (file ownership as before) | Done | tsc + build, e2e, `expo export` |
| 6 Verification | below | Done (500-viewer target not met on this machine — see results) | — |

### Run 6 results
| Check | Result |
|---|---|
| API suites, **twice over one database** | **48 suites, 1,461 checks per pass, 0 failed both passes.** New: teams 42, onboarding 27, support desk 19, tracing 13 |
| Migrations | 19 revisions (`…19_teams_onboarding_partitions`); downgrade → upgrade round trip clean; `alembic check` clean (partition children ignored in `env.py`); schema re-dumped (**102 tables**, dated partitions excluded); parity green |
| Browser (`node tests/e2e/run.mjs`) | screens **322/0**, axe **141/0**, speed **14/0** (watch video start 1.72 s, reels 1.64 s; JS home 176 / reels 391 / watch 413 KB of 420) |
| Mobile | tsc, `expo export` iOS + Android (agent), native imports green in both passes; not run on a device |
| Production stack `play.localhost:8443` | **smoke 166/0** incl. run 6 (editor invited by mail and accepted, acting channel, earnings owner-only, handle rename + 301, support-desk lookup); **CSP 36/0** |
| Load, 100 viewers + 200 sockets | **1,144 req/s, 0 errors, p95 ≤ 32 ms** (watch 32, ad decision 26); 198/200 sockets |
| Load, 500 viewers + 500 sockets | **not met here**: the stack saturates at ~1,050 req/s (4 workers) / ~1,350 req/s (6 workers) on the 6-CPU Docker VM while 500 viewers offer ~5,000 req/s, so p95 ≈ 500–560 ms and 71–81/500 sockets failed; 0–1 errors. Every endpoint rises evenly (queueing, not one slow query). The §18 target stays a measurement on the VPS |
| Slow queries | after a full suite pass the costliest statement is transcript full-text search (~30 ms mean, GIN-indexed); no missing index found |
| Security | gitleaks pass (after allowlisting SECURITY.md's quote of the run 4 prose false positive) · bandit 0 · semgrep 0 (262 rules, 805 files) · pip-audit 0 · npm audit: the same documented mobile-only findings (Expo deep-link parsing, fixed by the store-build SDK upgrade) |
| Backups · monitoring | off-host rehearsal 12/0 · `monitoring.sh check` 38 rules, promtool tests green |
| Dependencies | backend: 12 patch/minor bumps, `pip check` clean; FastAPI 0.141 → 0.162, pgvector 0.5 and uharfbuzz 0.57 not taken (0.x minors can break); frontends already on the newest patch/minor — only majors left (Vite 8, TypeScript 7, Recharts 3, Sonner 2, lucide 1, tailwind-merge 3, plugin-react 6) |

### Bugs found and fixed in run 6
- `test_analytics_reco` "finished video sits lower": the fan and the fresh viewers could land in different A/B arms (model vs
  heuristic) once a promoted model existed on the second pass — the suite now pins all three to the heuristic arm.
- Support sessions could never be used: the session row is under RLS and was read before any tenant was set (the dev API
  runs as the app role).
- `/repurpose/{pack_id}` would have swallowed `/repurpose/{id}.md` (422) — `{pack_id:int}`.
- The anonymous feed cache would have served one language's partnership label to everyone — the key now includes the language.
- Old handles answered 404 on playlists, support, live, posts and study endpoints — all use `handles.resolve` now.
- Import job counters were written only at the end of a run and not reset by resume — written per video now.
- Sign-up dropped `returnUrl`, so an invitee without an account lost the invitation link (shared auth package).
- `/studio/team/me` returned no permission map for a channel's own owner unless their user role was `owner`.

### Decisions taken in run 6
- One acting channel per request (header), never a second `tenant_id` on the user; viewer routes ignore it.
- Money stays with the owner: no role, matrix row or manager can reach billing or earnings; members cannot rename the handle.
- Seat limits are placeholders on the plans (`team_members`: free 1, pro 5, business 25).
- Connecting YouTube still imports everything (as before); bulk import is for picking more later and is idempotent.
- Partitions: only the default partition is created by the migration; months are made by the sweep so schema snapshots stay
  date-independent. Retention: impressions 90 days, activity log 365 days.
- Tracing is in-house OTLP/JSON (no OpenTelemetry dependency) and off unless an endpoint is set; Sentry tracing is unchanged.
- Support sessions are read-only.

### Still blocked or open after run 6
| Item | Needs |
|---|---|
| Everything from run 5 | accounts, CA, lawyer, VPS (unchanged) |
| 500-viewer load target | the VPS (this machine saturates at ~1,350 req/s) |
| Team mode gaps | `/api/video/me`, `/permissions` and `/tenant-features` describe the member's own account (plan meters, dashboard checklist); some view-only screens still show edit controls a member cannot save (the API refuses) |
| Error codes | 403s carry only translated text; a machine-readable `code` would let the apps tell "removed from the team" from "not allowed" |
| Verification mail | account links still go through the old SMTP `email_service`, so in sandbox they never reach the outbox (pre-existing; the desk shows "not sent") |
| Shared UI | `RoleEditor` cells need accessible names and keys; 11px slate-400 hints; six roles make the matrix scroll sideways |
| Mobile | no invite-accept screen or "leave channel" on the phone |

## Run 5 — ad integrity, Hindi & India-first, viewer growth, creator AI v2, V5.4 regions, V5.6 view pool (4 Nov 2026)

Owner's choice: these five tracks, overnight, no stops; V5.4 and V5.6 started early (the plan's measured-need gate is noted
in the plan HTML). Runs 1–4 committed (`d95dd50`, `cccf074`, `57d79d6`, `d1ba83c`). The baseline was taken as run 4's
final double pass on the identical committed tree. **Nothing committed, nothing deployed.**

| Phase | Scope | Status | Proven by |
|---|---|---|---|
| 1 Ad integrity & brand safety | Billing on a viewability event (`q0`, ≥ 2 s after `start`); invalid traffic not billed or shared (declared bots refused, data-centre CIDRs, per-IP/per-user bursts, other-viewer events, too-fast viewable/complete); brand-safety categories per video (title, tags, AI tags, scan labels) that campaigns can exclude; "made for kids" videos never get ads; CSV exports by day / category / device; admin invalid-traffic view; `kv_ads_invalid_total`, `kv_ads_viewable_total`, `KvAdInvalidTrafficHigh` | Done | `test_ads` 73 |
| 2 Hindi & India-first | Web fully in Hindi (lazy dictionaries, `Accept-Language` so server messages are Hindi), studio fully in Hindi, TV and mobile Hindi; Hinglish search (Devanagari ↔ Latin transliteration with schwa deletion and phonetic folding, `search_roman` tsvectors, `pg_trgm` typo fallback); partnership label on every card; device names on TV approval; Hindi feedback mail | Done | `test_search` 13, e2e Hindi screens + axe |
| 3 Viewer growth | Installable web app (manifest, icons, hand-written service worker that never caches API or media, offline page); picture-in-picture (web player, mobile); Premium offline downloads (6-hour MP4 link + 30-day viewer-bound licence, re-checked online, withdrawn when Premium lapses or the video is removed); notification inbox (push, new videos from followed channels, replies, deals) with web/studio/mobile bells and daily/weekly email digests; Subscriptions tab with "new since last visit" (web, mobile, TV) | Done (downloads/PiP not on a device) | `test_viewer_growth` 31 |
| 4 Creator AI v2 | AI thumbnails (sandbox Pillow designs from frames; Azure image adapter contract-tested), `ai_images` quota, AI-made label; Gujarati, Kannada, Malayalam, Punjabi, Odia for subtitles, dubbing voices and STT; chapter editor with versions; repurpose pack (blog post, X / LinkedIn / Instagram, newsletter, timestamp citations, Markdown); content calendar with scheduled, rescheduled and cancelled clip posts | Done (sandbox models) | `test_creator_ai` 32, `test_provider_contracts` 104 |
| 5 V5.4 regions + V5.6 view pool | `REGION` / `home_region` / `REGION_ENFORCE` / `/api/auth/region`, region readiness, `backend/.env.us.example`, a second local stack (`KV_STACK=staging-us`) and a region rehearsal; view pool = `ADS_VIEW_POOL_BPS` of net ad revenue split by qualified watch time (completion-weighted, free hosted videos, minutes floor), admin preview and run, Route direct transfers, "View pool" on statements | Done (sandbox / local) | `test_view_pool` 21, `tests/smoke/region_rehearsal.py` |
| 6 Frontends | Web, studio + admin, mobile + TV by three parallel agents (file ownership as in run 4) | Done | tsc + build, e2e, `expo export` |
| 7 Verification | below | Done | — |

### Run 5 results
| Check | Result |
|---|---|
| API suites, **twice over one database** | **44 suites, 1,344 checks per pass, 0 failed both passes.** New: viewer growth 31, creator AI 32, view pool & regions 21; grown: ads 73, search 13, provider contracts 104 |
| Migrations | 18 revisions (`…14_ad_integrity_and_brand_safety`, `…15_hinglish_search` with `pg_trgm` and a romanised backfill of 1,415 videos / 11,142 segments, `…16_notifications`, `…17_creator_ai_v2`, `…18_regions_and_view_pool`); `alembic check` clean; schema re-dumped (**95 tables**); parity green |
| Browser (`node tests/e2e/run.mjs`, four apps, English + Hindi) | screens **319/0**, axe WCAG 2.2 AA **139/0** (incl. Hindi and run-5 screens at 390 px), speed **14/0** (watch video start 1.75 s, reels 1.63 s; JS home 176 / reels 391 / watch 413 KB of 420 — Hindi watch measured at 419 KB) |
| Mobile | tsc, `expo export` iOS + Android, native imports 12/0; not run on a device |
| Production stack `play.localhost:8443` | **smoke 157/0** incl. the run 4 journeys and run 5 (region discovery, Hindi server messages, bots get no ad, Premium download link + MP4, inbox, view-pool preview, Hinglish search, the service worker served `no-cache`, the manifest); **CSP 36/0** |
| US-region rehearsal | a second stack `play-us.localhost:9443` (`KV_STACK=staging-us`) beside India: **6/0** — each host reports its region, US sign-ups land in the US database only, Indian sign-ups on the US host are sent to India, accounts sign in only on their home host |
| Load on the stack | 100 viewers + 200 sockets: **1,148 req/s, 0 errors, p95 ≤ 29 ms** (ad breaks / decision p95 25 ms, now through the real decision path with a browser UA); live **1,000/1,000 watchers, 55,000/55,000 deliveries, fan-out p95 62 ms**, HLS p95 75 ms |
| Security | gitleaks 0 (after one prose false positive allowlisted) · bandit 0 · semgrep 0 (262 rules, 782 files) · pip-audit 0 · npm audit pass (same 3 allow-listed dev tools) |
| Backups · monitoring | off-host rehearsal 12/0 · `monitoring.sh check` 38 rules incl. `KvAdInvalidTrafficHigh`, `KvDigestNotSent`, all promtool tests green |

### Bugs found and fixed in run 5
- `route_transfers.kind` was `String(8)`: a `view_pool` transfer was truncated and surfaced as a 422 ("out of range") —
  widened to 10 (and the trap noted in CLAUDE.md).
- Ad refunds lost a paisa twice (refund gross and taxable split rounded differently) — both round half-up now.
- `made_for_kids` was passed to a helper that did not accept it (500 on every upload until fixed in the router).
- Saving any video detail reset the brand-safety labels — now only when title, description, tags or the kids flag change.
- `pg_trgm` was missing from the schema dump, so the parity check could not load the schema.
- A gitleaks false positive already in commit `d1ba83c` (prose in this file) — allowlisted by the exact phrase.
- The staging overlay hard-coded its env file and container names, so a second (US) stack could not start — both now follow `KV_STACK`.
- The smoke's download check used a video its own takedown journey had removed (correct 403) — it now downloads a published one.
- Process: the first full run stopped at `test_security` on the new public `/ads/categories` route, which is public by design (allowlisted).

### Decisions taken in run 5
- Billing moved from `start` to `q0` (2 s viewable); invalid traffic is recorded per reason and never billed or shared.
  Declared bots get no ad at all; data-centre ranges come from `ADS_IVT_CIDRS` (empty until an IVT vendor supplies them).
- Hinglish search is an in-house transliteration (no new dependency); English loanwords written in Devanagari do not always
  meet their English spelling — their English text is indexed anyway.
- Downloads are licences, not DRM (plain MP4 on the device, 30-day licence, re-checked online).
- Digest default weekly (Mondays 08:00 IST), opt-out — **confirm DPDP consent**.
- The US host runs the same compose file with `backend/.env.us.example` (no separate overlay); Lemon Squeezy is its only
  rail; accounts are pinned by country (US, CA → us).
- View pool placeholder 10% of net ad revenue, `VIEW_POOL_MIN_MINUTES` 60, completion weighting 0.5–1.0.
- One profile language drives both the interface and the content language; the web shows them separately.

### Still blocked or open after run 5
| Item | Needs |
|---|---|
| Everything from run 4 | accounts, CA, lawyer, VPS (unchanged) |
| Device runs | downloads, PiP and background audio on a real phone; TV wrappers |
| DRM for downloads | a DRM provider (Bunny/Cloudflare) if creators require it |
| IVT vendor | real data-centre lists and fraud signals |
| US host | a second VPS, DNS `us.play.klygenix.com`, US Bunny library, Lemon Squeezy store |
| Small gaps | server-side partnership label is English; `/admin/ads/ivt` has no date filter; chapter history keeps no old contents; only the latest repurpose pack is listed; notifications carry no app field |
| Known flake | `test_analytics_reco` "finished video sits lower" (affinity cache timing, from run 4) |

## Run 4 — provider go-live readiness, trust & safety, closed beta, V5 on the sandbox (3–4 Nov 2026)

Owner's choice: all four tracks, overnight, no stops; V5.1 / V5.2 / V5.3 / V5.5 started early (the plan's measured-need
gate is noted in the plan HTML). Runs 1–3 committed as `d95dd50`, `cccf074`, `57d79d6`. **Nothing committed, nothing
deployed.**

| Phase | Scope | Status | Proven by |
|---|---|---|---|
| 1 Provider readiness | Contract tests for every real adapter against fakes of their documented APIs (`tests/fakehttp.py`); Cloudflare Stream wired into live (create/rotate input, RTMPS ingest, RS256 signed playback, Stream + Notifications webhooks, idle end, replay import provider-to-provider via `ingest_url`); Expo receipts; Instagram token refresh; `python -m app.providers_check` (+ `make -C infra providers-check`); `docs/GO-LIVE.md`; readiness needs the full Cloudflare set | Done (no live call made) | `test_provider_contracts` 101, `test_live_cloudflare` 27 |
| 2 Trust & safety | Report live chat messages and streams (moderation queue, admin remove → hide with refund / stop stream / strike); counter-notices (uploader-only, sworn, mailed to the claimant, restore after 10 business days unless "court action" = `upheld`); takedown clocks in `TAKEDOWN_SLA_HOURS`; `kv_trust_overdue` + `KvTrustOverdue` (acknowledgement); IT Rules monthly compliance report (JSON/CSV) | Done | `test_trust_beta` 75 |
| 3 Closed beta | `SIGNUP_MODE` / `CREATOR_SIGNUP`; hashed invite codes (role, uses, expiry, email binding, revoke); waitlist with confirmation; `mailer.py` (EN/HI templates, sandbox outbox, Graph/SMTP delivery job); in-app feedback with screenshot; creator onboarding checklist | Done | `test_trust_beta` |
| 4 V5.1 Ads | Brand profiles, campaigns (CPM, budget, daily cap, targeting), admin review, eligibility (hosted long videos, free, opted-in, not own, not Premium), pre-roll + chapter-snapped mid-rolls past 8 min, Redis impression tokens and events, caps, budget stop, flush to `ad_daily`, accrual (`ad_unearned` → `ad_income`), platform invoice `KVA`, unspent refund with credit note, monthly 55% creator share by Route direct transfer | Done (sandbox rail) | `test_ads` 55 |
| 5 V5.2 Sponsorships | Briefs, applications, deals; escrow through `record_split` (10% commission, creator's GST, KVC invoice) with the sale transfer held until approval; delivery sets a server-side "Paid partnership with {brand}"; approve / auto-approve after 7 days / dispute → admin release or refund / cancel → refund | Done (sandbox rail) | `test_sponsorships` 41 |
| 6 V5.5 Recommender | Sampled feed impressions (Redis → `kv_ai.reco_impressions`), labels from watch progress, 10 features, numpy logistic ranker with time-split AUC / NDCG@10 vs the heuristic, auto-promote only when it beats it, A/B arm by user hash, admin promote/rollback, nightly training, `kv_reco_ctr_bps`, `KvRecoModelStale` | Done (`RECO_MODEL=off` by default) | `test_reco_model` 25 (synthetic viewers: AUC 0.72 vs 0.54, NDCG@10 0.69 vs 0.37) |
| 7 V5.3 TV | `apps/tv` (5303/5313, `tv.${PUBLIC_DOMAIN}`): 10-foot UI, in-house D-pad focus manager, Home rows, Watch with ads and partnership label, Live, Search with an on-screen keyboard, Channel, Profile, feedback; sign-in by device code (RFC 8628 shape) approved at web `/activate`; nginx host + CSP, compose mount, build/deploy scripts | Done (no native TV build) | `test_device_login` 15; e2e TV screens, keyboard-only check, axe |
| 8 Frontends | Web: ad slot (`packages/player` `AdBreak`, `HlsPlayer` `hold`/`onError`), partnership label, live reports, counter-notice page, invite/waitlist sign-up, feedback, `/activate`, `/brands`. Studio: onboarding card, invite for channels, Ads tab + per-video switch, Brand mode (profile, campaigns, briefs, deals), creator Sponsorships, deal page, Notices, reconnect, feedback. Admin: Beta (waitlist, codes, outbox, feedback), live targets in moderation, counter-notices and court action, compliance report, Advertising, Sponsorships, Recommender. Mobile: ads in Watch, live reports, feedback, label | Done (mobile not on a device) | tsc + build; e2e; `expo export`; native imports |
| 9 Verification | below | Done | — |

### Run 4 results
| Check | Result |
|---|---|
| API suites, **twice over one database** | **41 suites, 1,234 checks per pass.** Pass 2: 0 failed. Pass 1: 1 failed — `test_analytics_reco` "the finished video sits lower…", unchanged run-1 test, passed 3/3 alone and in pass 2: a timing flake in the 2-minute affinity cache (logged below). New: provider contracts 101, Cloudflare live 27, trust & beta 75, ads 55, sponsorships 41, recommender 25, device login 15 |
| Migrations | 13 revisions (`kv0000000011_trust_beta`, `…12_ads_and_sponsorships`, `…13_reco_model`); `alembic check` clean; schema re-dumped (**93 tables**); parity green |
| Browser (`node tests/e2e/run.mjs`, now four apps) | screens **231/0**, axe WCAG 2.2 AA **118/0**, speed **14/0** (watch video start 1.72 s, reels 1.61 s; watch JS 414 of 420 KB budget) |
| Mobile | tsc, `expo export` iOS + Android, native imports 12/0; not run on a device |
| Production stack `play.localhost:8443` (now with `tv.`) | **smoke 147/0** incl. the run 4 journeys through the real workers (an ad served and flushed into spend by the scheduler, unspent budget refunded; a sponsorship funded, delivered with its "Paid partnership" label and approved; a takedown receipt mail and a counter-notice; waitlist confirm; an invite code; feedback; a TV device sign-in); **CSP 36/0** incl. `tv.`, `/activate`, `/waitlist`. Found: the staging overlay did not mount `apps/tv/dist` (fixed); a smoke run now uses ~10 sign-ups, so a second run within the hour hits the per-IP limit |
| Load on the stack | 100 viewers + 200 sockets: **1,144 req/s, 0 errors, p95 ≤ 32 ms** per step (ad breaks / decision p95 26 ms); live room **1,000/1,000 watchers, 55,000/55,000 deliveries, fan-out p95 64 ms**, HLS p95 86 ms |
| Backups | off-host rehearsal 12/0 |
| Security | gitleaks 0 · bandit 0 medium+ · semgrep 0 (262 rules, 720 files) · pip-audit 0 · npm audit pass (same 3 allow-listed dev tools) |
| Monitoring | `monitoring.sh check` green, 36 rules incl. `KvTrustOverdue`, `KvAdDeliveryErrors`, `KvRecoModelStale` with promtool unit tests |

### Bugs found and fixed in run 4
- **The production env example could not have launched Play**: no `BUNNY_*`, LLM, STT, TTS, scan, Route-category, Lemon
  Squeezy or Cloudflare signing keys; it still carried Store's lesson-video settings (`VIDEO_LIBRARY_ID`, VAPID,
  RazorpayX). Rewritten; `providers_check` now reads it.
- **Instagram, Expo, Azure TTS and Cloudflare secrets were never decrypted** from sealed `enc:` values (missing from the
  config validator) — a sealed production value would have been sent as ciphertext.
- Dead Store code (`video/services/video.py`) referenced settings that do not exist and would crash with `VIDEO_PROVIDER=bunny`; removed (nothing imported it).
- **Clip-ready pushes were silently dropped** when a re-render finished in the same second (dedupe key in whole seconds) — found by the suites; now milliseconds.
- Cloudflare events broadcast after the session closed (detached instance) — found by the new test.
- A new waitlist row's status was `None` before flush, so the confirmation mail was never sent; the admin ads report
  grouped three separate `to_char` expressions (500); studio video data lacked `ads_enabled`; the onboarding upload
  link pointed at a missing route; the success-toast text was 4.25:1 (now darker in `packages/ui`).
- Run-4 process slip: a migration applied while the baseline suites ran deadlocked one test (`apply_tenancy` locks) —
  now a trap in CLAUDE.md.

### Decisions taken in run 4
- Ads and sponsorship tables live in `kv_commerce` (existing grants and RLS), not a new `kv_ads` schema; invite codes,
  waitlist, outbox and feedback in `kv_admin` (platform-only, no RLS); recommender tables shared in `kv_ai`.
- Ads: never on embeds, **reels**, members-only/paid videos, the creator's own videos or for Premium viewers; creators
  opt in per channel (default off), per video default on; CPM floor ₹50; top-ups ₹1,000–₹10,00,000; creator share 55%
  of spend on their videos, monthly (placeholders). A brand needs no channel for its console but uploads the creative
  (≤ 60 s, unlisted) through a channel.
- Sponsorship commission 10%; auto-approve 7 days after delivery; the label is server-set and cannot be removed.
- Counter-notice restore after 10 business days; the existing `KvTakedownsOverdue` keeps resolve deadlines,
  `KvTrustOverdue` only the acknowledgement clock (no double paging).
- `RECO_MODEL=off`, `RECO_AB_PERCENT=50`; a model is auto-promoted only with ≥ 100 test rows and NDCG@10 above the heuristic.
- The TV app sends `X-Klygenix-App: tv`; ad device targeting reads it before the User-Agent.

### Still blocked or open after run 4
| Item | Needs |
|---|---|
| Every real provider | accounts and keys; then `providers_check --live` (docs/GO-LIVE.md). Bunny's Fetch Video response must be checked once for the new video id |
| Ad and sponsorship money | CA sign-off (GST on ads, tax on the creator share and sponsorships), Route keys, ASCI/advertiser policy text, brand and sponsorship terms (`docs/LEGAL-OPEN.md`) |
| Native TV and phone builds | store accounts, devices (Tizen/webOS/Android TV/tvOS wrappers not started) |
| Recommender on real traffic | real impressions; `RECO_MODEL=on` only after a nightly model beats the heuristic |
| Known flake | `test_analytics_reco` "finished video sits lower" depends on the 2-minute affinity cache timing (failed 1 of 5 runs this night) |
| Small gaps | reels cards carry no partnership label; web strings are English-only (no i18n in apps/web); the device-approval page cannot show the device's name |
| As before | lawyer review, Meta review, CA sign-off, VPS/DNS, the 500-viewer server run |

## Run 3 — V4 Live on the sandbox, mobile store-ready, launch hardening (3 Nov 2026)

Owner's choice: all three tracks, overnight, no stops. Runs 1 and 2 committed as `d95dd50` and `cccf074`.
**Nothing from run 3 is committed** (the owner commits by hand) **and nothing is deployed.**

| Track | Built | Proven by |
|---|---|---|
| V4.1 provider | `live/service.py` behind `LIVE_PROVIDER`; sandbox ingest; `live/cloudflare.py` written to Cloudflare Stream Live's API (**not wired yet**) | `test_live.py` |
| V4.2 go live | OBS/RTMP: one always-on gate per pool port checks the AMF0 `publish` key (`live/gate.py`, `hmac.compare_digest`) and forwards to `ffmpeg -listen` on loopback; 1 s HLS + recording (tee); browser camera over `/ws/live/{id}/ingest` with a signed ticket; keys sealed, hashed, rotatable; auto-end after 45 s idle; `live` and `ended` events on the room | `test_live.py` 53 checks (wrong key never goes live) |
| V4.3 chat | live rooms on `realtime/hub.py` (one Redis pubsub per process; V07); presence and peak in Redis; run-1 filter; slow mode; timeouts by message; channel moderators; `mine` flag | `test_live.py`, `tests/load/live.py` |
| V4.4 paid live | super chats (₹49/₹199/₹499, pinned 30 s/2 min/5 min) and gifts (₹19/₹49/₹199) as support purposes split through `record_split`; hiding a paid message (creator **or moderator**) refunds it | `test_live.py` |
| V4.5 replays | on end the recording becomes an MP4 → `ingest_file` → the normal pipeline (scan, AI, publish rules); replays can be turned off | `test_live.py`, stack smoke live journey |
| V4.6 load | `tests/load/live.py` (watchers + chatters + HLS pollers) | see results |
| Push | `PUSH_PROVIDER=sandbox|expo` (`services/push.py`): render ready, published, followed channel live, membership lapsing; per-user switches; dedupe keys; Expo adapter untested live | `test_push.py` 14 |
| Mobile | Expo SDK 58 / RN 0.88.1 / React 19.3.0; EAS profiles (development, preview, production) with env; icons, splash, permissions, privacy manifest; live watch + chat; Study tab (`/me/study`); notification switches + history; Hindi strings for the core screens; `docs/STORE.md` listing kit | tsc, `expo export` iOS + Android, native imports 12/0 |
| Instagram (V2.9) | Instagram API with Instagram Login (sandbox fake professional account), connect/callback, publish targets need a connected account | `test_publishing.py` 29 |
| Retention | sweep: Ask history 365 d, push log 90 d, live chat 90 d after the stream, translations 180 d, leftover deleted media 30 d, live segments 24 h; streams that never went live close after 24 h (each held a sandbox RTMP port) | `test_retention.py` 10 |
| Admin ops | audit log viewer (filters, totals, JSON diffs), failed jobs with retry (render, dub, publish, payment event, AI re-analysis), live streams with force stop | `test_admin_ops.py` 21; admin pages in e2e |
| Legal drafts | Terms, Privacy, Guidelines, Copyright & counter-notice, Grievance, Creator Monetisation, Live Rules — each "Draft — pending legal review"; every placeholder in `docs/LEGAL-OPEN.md` | web pages; e2e screens |
| Deploy | `deploy.sh` keeps the previous image (`:current-prev`) and `dist.prev`; `--rollback` restores them; rehearsed against a throwaway SSH host (guard → deploy → second deploy → rollback) | rehearsal (docs/LAUNCH.md §12) |
| Monitoring | `kv_live_streams`, `kv_live_ingest_stale`, `kv_realtime_dropped_total`; alerts `KvLiveIngestDown`, `KvLiveFanoutSlow` with promtool unit tests | `monitoring.sh check` (33 rules) |

### Run 3 results
| Check | Result |
|---|---|
| API suites, **twice over one database** | **34 suites, 894 checks per pass, 0 failed both passes.** New: live 53, push 14, retention 9 (10 after a last check added below, rerun alone), admin ops 21; grown: publishing 29, learning 36, viewer extras 64 |
| Migrations | 10 revisions (`kv0000000008_live`, `…09_push_and_live_provider`, `…10_instagram_connect`); `alembic check` clean; schema re-dumped (80 tables); parity green (public-read policies 15 → 17) |
| Frontends | tsc + vite build green for web, studio, admin; mobile tsc + `expo export` iOS + Android on SDK 58 |
| Browser (`node tests/e2e/run.mjs`) | screens **150/0** (incl. studio Live, admin Audit log / Failed jobs / Live streams), axe **80/0**, speed **14/0** (reels video start 1.65 s, LCP 1.2–1.5 s) |
| Production stack `play.localhost:8443` (now with the `live` service) | **smoke 111/0** incl. the live journey (RTMP publish into the stack → live playlist → chat → end → replay published by the workers); **CSP 27/0** |
| Viewer load on the stack (100 continuous viewers + 200 sockets, nginx + TLS, 4 API workers) | **924 req/s, 0 errors, p95 6–15 ms** per step (run 2: 471 req/s at p95 300–380 ms); 198/200 sockets opened, live danmaku delivered |
| Viewer load, dev API, 4 workers | 100 viewers p95 ≤ 33 ms; **300 viewers + 300 sockets: 1,251 req/s, p95 ≤ 200 ms, 0 errors** |
| Live room on the stack | **1,000/1,000 watchers, 55,000/55,000 deliveries, fan-out p95 63 ms** (target < 500 ms), HLS playlist + segment p95 99 ms, 0 errors |
| Backups | off-host rehearsal 12/0 |
| Security | gitleaks 0 · bandit 0 medium+ (1 fixed: the RTMP gate bound all interfaces — now `LIVE_GATE_BIND`, loopback by default) · semgrep 0 · pip-audit 0 · npm audit pass with 3 allow-listed dev-tool findings (5 Expo findings cleared by SDK 58) |

### Bugs found and fixed in run 3
- **Two real throughput bugs behind run 2's p95**: the API ran as one process, and `/ws/videos` ran a sync DB query on the
  event loop — with the pool empty it froze the whole worker for the 10 s pool timeout. Now `WEB_CONCURRENCY` workers,
  WebSocket lookups in a thread, request threads capped at the pool size, HTTP metrics shared through Redis.
- **nginx had no upstream keepalive**: at ~900 req/s it ran out of local ports and every request 502'd. Upstream with
  `keepalive` + `resolve` on `nginx:1.30-alpine`.
- **IST dates**: analytics windows, GST invoice/credit-note dates, ledger dates and FY number series used the server's
  local date (UTC in containers) — wrong between 00:00 and 05:30 IST and on 1 April. Now `clock.ist_today()`.
- **Audit actor was "unknown"** for every platform admin action; admin routes now record the admin and IP, background work
  is `system`, nested values stay JSON.
- Data export and erase missed live chat and the push log; the analytics test caught the date bug at 00:30 IST.
- A wrong RTMP key went live (ffmpeg only warns) — the gate; the gate's first versions deadlocked the handshake.
- The load tool measured its own event-loop lag (600 ms "p95" vs 10 ms on the server) — `--procs`.

### Decisions taken in run 3
- **A channel moderator hiding a paid live super chat or gift refunds it**, like the creator. The buyer paid for
  visibility. (Boosted danmaku is unchanged: only the creator deleting it refunds.)
- Moderators time out by message, so numeric user ids are not published in chat.
- Live is India/INR money only, never on embeds; the mobile app links to the web for super chats and gifts.
- Production live goes through Cloudflare Stream; the sandbox `live` service must never run on the production host.
- Dev and staging RTMP port ranges differ (19350–59 / 19450–59).

### Still blocked or open after run 3
| Item | Needs |
|---|---|
| Live in production | Cloudflare Stream account + token; wire `live/cloudflare.py` into `live/service.py` (create input, ingest details, `connected`/`disconnected` webhooks, replay import) |
| Live money | CA sign-off and Route keys (as run 2) |
| Store builds, device run, in-app purchases | Apple and Google developer accounts; `eas init`; APNs key and FCM in EAS; a simulator or device; designed icon and screenshots |
| Instagram live | Meta app review (`instagram_business_content_publish`); a token-refresh job (60-day tokens) |
| Reporting live chat/streams | `/reports` targets `live_message` and `live` (migration + moderation queue) — in-room moderation and the admin stop exist |
| Counter-notices | an endpoint writing `kv_trust.takedowns.counter_notice` (the web uses the appeal route) |
| Takedown clocks | lawyer to confirm 72 h / 36 h windows (`routers/trust.py` SLA) — in `docs/LEGAL-OPEN.md` |
| Legal | lawyer review of the seven drafts and every `[PLACEHOLDER]` |
| The server rerun | 500 viewers on the real VPS (this Mac: 300 viewers p95 ≤ 200 ms on dev, 100 viewers p95 ≤ 15 ms on the stack) |
| VPS / DNS | the host and domain |

## Run 2 — V1 gaps, V2 Earn on the sandbox rail, V3 Community & learning (3 Nov 2026)

Owner's choice: build all of V2 now on the sandbox rail; live money waits for CA sign-off, creator KYC and Play's
Razorpay Route keys. Started from the owner's commit `d95dd50`. **Nothing committed, nothing deployed.**

| Phase | Scope | Status | Proven by |
|---|---|---|---|
| 1 V1 gaps | Clip reframe keyframes + face tracking (sandbox marker / OpenCV Haar, smoothing, piecewise crop); speed suite (4G video start, LCP, TBT, JS); 240p rung + 2 s segments; thumbnails 854 px; Ask suite at 50 questions EN + HI; off-host backups (ship, deep verify, repair, prune, restore from target) + `KvBackupNotShipped`; `restore.sh` verification fixed | Done (face quality untested on real footage; R2 itself blocked) | `test_clips`, `test_ask_citations`, `tests/e2e/speed.mjs`, `infra/backup-ship-rehearse.sh` |
| 2 V2.1 money foundation | Payout accounts + KYC (Route linked accounts, sealed bank number), creator splits (commission + GST, TCS s.52, TDS 194-O, reserve), Route transfers held for the refund window, release sweep, refund unwind with recovery netting, commission invoices, GSTR-8 / 194-O files, one `entitlements.revoke()` | Done (sandbox rail) | `test_payouts` |
| 3 V2.2–V2.6 | Tips (highlighted comment), boost danmaku (pre-checked text, live broadcast, creator delete refunds), memberships with tiers (members-only videos + posts, 60 s preview, lapse), paid videos and series, admin refunds for every purpose with credit notes; nothing on embeds | Done (sandbox rail) | `test_monetisation`, `test_refunds`, `test_embed_policy` |
| 4 V2 non-money | Retention curve + traffic sources + revenue by stream; recommendations v1.5 (video vectors, viewer taste); publish clips to YouTube Shorts / Instagram Reels (adapters + sandbox); product links with disclosure; licensed music library with ducking | Done (YouTube upload untested live; Instagram connection not built) | `test_analytics_reco`, `test_publishing` |
| 5 V3 | Community posts + polls + members-only posts; channel moderators; comment/danmaku translation (cached) and "what people are saying"; notes, quizzes, flashcards grounded in timestamps; Ask across a channel or a series; AI dubbing with consent and an "AI-dubbed" label | Done (sandbox models and TTS) | `test_community`, `test_learning`, `test_dubbing` |
| 6 Frontends | Web: tips, boosts, paywalls (watch + reels), memberships, purchases, study panel, notes, quiz, channel/series Ask, community, translation, comment summary, products, dub audio switch, traffic sources. Studio: Earnings (payouts, balances, tiers, sales, statements), monetisation per video, series price, analytics charts, keyframe/track reframe, music, publish targets, product links, community posts, moderators, dubbing. Admin: Money (summary, creators, transfers, payments + refunds, tax files). Mobile: lock cards, badges, products, notes, community, memberships, purchases, dub switch — money only via the web | Done | tsc + build, e2e 138/72/14 |
| 7 Verification | Suites ×2, parity, e2e, speed, production stack + smoke money journeys, load, scans, docs | Done | results below |
| 8 Stretch V4 live | not started | — | — |

### Run 2 results
| Check | Result |
|---|---|
| API suites, **twice over one database** | **30 suites, 800 checks per pass, 0 failed both passes.** New in run 2: payouts 67, monetisation 51, refunds 16, analytics + recommendations 17, publishing 24, community 33, learning 34, dubbing 16; grown: clips 33, Ask citations 13 (50 questions EN + HI), embed policy 29, readiness 24, upload flow 20 |
| Migrations | 7 revisions (`kv0000000006_creator_money`, `kv0000000007_community_learning_analytics`); `alembic check` clean; 77 tables; parity green (public-read policies 10 → 15) |
| Frontends | tsc + vite build green for web, studio, admin; mobile tsc + `expo export` iOS + Android; native imports 12/0 |
| Browser (`node tests/e2e/run.mjs`) | screens **138/0**, axe WCAG 2.2 AA **72/0**, speed **14/0** |
| Speed on 4G (9 Mbps, 170 ms, 4× CPU, 390 px, cold) | video start **watch ≈ 1.5 s, reels ≈ 1.6 s** (target < 2 s, plan §18); LCP home 1.5 s, reels 1.2 s, watch 1.4 s; TBT < 100 ms. Slow 4G (reported, not gated): LCP 2.6–3.5 s, video start 4.4–4.6 s. Fixes: 854 px thumbnails, 240p rung + 2 s segments, route loaders prefetch data, preconnect, hls.js preloaded, the HLS chain warmed from the loader, neighbouring reels wait for the active one |
| Production stack `play.localhost:8443` | rebuilt; **smoke 103/0** incl. the creator-money journey through the real workers (payout account → tip → split held on Route → statement → tier → members-only lock → join → full stream → admin refund → tip transfers reversed); **CSP 27/0** |
| Load (100 continuous viewers + 200 sockets, nginx + TLS) | **471 req/s, 0 errors, p95 300–380 ms**, 200/200 sockets got live danmaku. Run 1 measured 523 req/s at p95 200–330 ms; each feed/watch request now does more (locks, products, dubs, recommendations; affinity cached 2 min). **The 500-viewer / p95 < 300 ms target is still not proven** — rerun on the server |
| Off-host backups (`infra/backup-ship-rehearse.sh`) | 12/0: dump → ship → verify → tamper caught → `--repair` → restore from the target into a scratch DB → verified; retention keeps a monthly dump for 7 years |
| Monitoring | `monitoring.sh check` green, 31 rules incl. `KvBackupNotShipped` (+ unit test) |
| Security | gitleaks 0 · bandit 0 medium+ (2 fixed: fixed `/tmp` paths in backup shipping) · semgrep 0 (262 rules, 574 files) · pip-audit 0 (opencv-python-headless 4.14.0.94 added) · npm: the same 5 Expo-toolchain highs, allow-listed — **Expo SDK 58 is now the `latest` release (58.0.23)**, so the upgrade can be done next |

### Bugs found and fixed in run 2
- **The reels feed handed out the full stream of members-only and paid reels** (found by the mobile agent); it now serves the preview and marks `locked`, with a regression check.
- `infra/restore.sh` verified against Pay's tables (`kp_%`, `kv_ar_tmp.invoices`): every restore would have failed at the check.
- OpenCV 5 removed `CascadeClassifier` — pinned 4.14.
- Speed: the first measurement was invalid (the measuring server's port was not an allowed origin); after fixing it the real LCP was 3.2–3.9 s on Slow 4G — see the fixes above.
- Tests made robust to a growing database (search) and to async workers (payments, publishing, party broadcasts).

### Decisions taken in run 2
- V2 built on the sandbox rail now (owner's choice); money is India/INR only and never on embeds.
- Commission placeholders 20/10/8% (free/pro/business), tips ₹10–₹10,000, boosts ₹29/₹99/₹199, reserve 5% for 30 days, refund window 7 days — **owner and CA to confirm**.
- Tips carry no GST or TCS; a creator's own GST applies to boosts, memberships and paid videos only when they gave a GSTIN.
- A creator deleting a paid boost refunds it; a moderator hiding it does not (state it in the guidelines).
- Locked videos: 60 s preview on the sandbox provider; Bunny has no preview, so its locked viewers see only the paywall.
- Search never shows transcript text from members-only or paid videos.
- Ask across a channel/series skips videos the viewer cannot open and says how many (`skipped_locked`).
- Dubbed audio is a separate AAC track synced by the player (byte ranges served), not an HLS audio rendition.
- The mobile app sells nothing; every money action opens the web.

### Still blocked or open after run 2
| Item | Needs |
|---|---|
| Live creator money | CA sign-off (commission GST, TCS s.52/GSTR-8, TDS 194-O, tips), Play's Razorpay keys with Route, `ROUTE_PROFILE_CATEGORY/SUBCATEGORY` from Razorpay, prices and rates confirmed |
| Paid content on Bunny | `BUNNY_TOKEN_KEY` (token auth) — without it Bunny URLs are public |
| In-app purchases (V2.8), store builds (V1.24) | Apple and Google developer accounts; Expo SDK 58 upgrade first |
| Instagram publishing | a Meta app and per-creator Instagram account connection (not built) |
| Bilibili connect (V2.10) | Bilibili Open Platform admission |
| Real TTS voices, real face detection quality | Azure TTS key; a test on real footage |
| Off-host target | the R2/S3 bucket and keys |
| V4 Live | not started (stretch) |

## Results — 3 Nov 2026 (end of the run)

| Check | Result |
|---|---|
| API suites, **twice over one database** | 22 suites, **512 checks per pass, 0 failed both passes** (accounts 22, tenancy 15, upload 19, AI pipeline 25, search 8, Ask citations 8, quota 4, social 35, clips 16, plans & billing 21, moderation 30, embed policy 24, viewer extras 62, playlists 27, parties 19, thumbnails 17, security sweep 13, readiness 22, Graph mail 35, error tracking 72, native imports 12, migration parity 6) |
| Migrations | 5 revisions; `alembic upgrade head` + `alembic check` clean; `01-schema.sql` re-dumped; parity green |
| Frontends | `tsc -p tsconfig.app.json` + `vite build` green for web, studio, admin; `tsc --noEmit` green for mobile; `expo export` iOS + Android bundled (mobile agent) |
| Browser (`node tests/e2e/run.mjs`) | screens **129 passed, 0 failed** (every web route anonymous and signed in at 390 px, every studio and admin sidebar screen, upload drawer, no script errors, no failed API calls); axe **66 passed, 0 failed** (WCAG 2.2 AA, serious/critical; web at 1280 and 360, studio and admin light and dark) |
| Production stack on `play.localhost:8443` (`infra/local-stack.sh up`) | backend ×3 workers, worker-ai, worker-render, scheduler, nginx from the `${PUBLIC_DOMAIN}` template, Postgres + Redis + mailpit; **smoke 90 passed, 0 failed** — headers, caching, compression, CORS, share heads, and a full journey through the real RQ workers (sign-up → upload → encode → scan → AI → publish → HLS → Creator Pro purchase → invoice); **CSP 27 passed, 0 failed**; demo seed run through the workers |
| Load (`tests/load/viewers.py`) | Dev process (1 worker): ~330 req/s at p95 < 125 ms with 40 continuous viewers (after the 15 s anonymous feed cache; ~180 before). Production stack through nginx + TLS: **523 req/s, 0 errors, p95 ≈ 200–330 ms with 100 continuous viewers and 200 WebSocket watchers** (all received live danmaku); 300 viewers + 500 sockets saturated this Mac (Docker VM: 6 CPUs shared with Postgres, workers, the generator and other repos' containers) — 336 req/s, p95 1.5–6.7 s, 0 errors, 500/500 sockets. A "continuous viewer" fires a request every ~0.5 s; a real viewer a few per minute. **The plan's 500-viewer / p95 < 300 ms target is not proven** — rerun on the VPS. |
| Security (docs/SECURITY.md) | gitleaks 0 · bandit 0 medium+ · semgrep 0 · pip-audit 0 (after Pillow 13.0.0, pypdf 6.21.4) · npm: 5 high in the Expo toolchain, allow-listed until 31 Dec 2026 (fix = Expo SDK 58) |
| Monitoring | `infra/monitoring.sh check`: promtool rules (30) + unit tests, config, amtool, blackbox — green |

### Bugs found and fixed during verification
- An uploaded custom thumbnail was saved but never shown on cards.
- Every studio multipart upload (thumbnail, avatar, banner, captions) answered 422 — the shared client sent JSON.
- Staging CSP and the http→https redirect dropped the `:8443` port (`PUBLIC_PORT` added to the nginx template).
- The backend's single-file mount of `dist/index.html` went stale after a rebuild (share heads 404) — now a directory mount.
- `GET /me/playlists/{id}/progress` validated before authenticating (security sweep).
- Search ties between identical videos had no tie-break (newest now wins).
- a11y: names that hid visible text, low-contrast pills and faint text, unfocusable scroll regions, un-underlined in-text links.

### Left on the machine for the morning
- The production stack is **still running** on https://play.localhost:8443 (studio / admin / api subdomains; self-signed certificate) with the demo seed; `bash infra/local-stack.sh down` stops it. Its admin password is in `infra/.env.staging` (generated, gitignored).
- `apps/*/dist` are built for that staging stack; `deploy.sh` rebuilds for production.
- The dev API on :9300 (from `backend/`, log `/tmp/kv-api.log`) and the dev Postgres/Redis containers.

## Sandbox-only (works end to end here, never called live)
Bunny Stream · Azure OpenAI, embeddings and Speech · the safety vendor · Google OAuth / YouTube Data API ·
Razorpay and Lemon Squeezy · Microsoft Graph mail · Expo push. Each real adapter is written to the
provider's documented API behind the same interface; `docs/PROVIDERS.md` lists the keys and the order.

## Decisions taken during the run
- **No MinIO in dev**: its images could not be pulled here; dev stores files on the local adapter (S3 adapter kept).
- **Reframe is center or manual keyframes**, no face tracking (OpenCV not added). Plan V1.20 stays in progress.
- **Captions are drawn by Pillow**, not libass/drawtext: the Homebrew ffmpeg on this Mac has neither, and one path keeps dev and prod identical.
- **GST is 0 until the admin tenant's GSTIN is set** in the studio settings (the tax engine is Store's).
- **Team members (`video.users`) not ported**: a channel is one person in V1. Studio Settings shows "coming soon".
- **Channel handles are read-only after creation** — shared `/@handle` links and share heads would break without a redirect table.
- **Anonymous home and reels feeds are cached in Redis for 15 s** (one process went from ~180 to ~330 req/s).
- **Uvicorn workers come from `WEB_CONCURRENCY`** (3 in the image).

## Blocked (needs the owner or an account)
| Item | Needs | Next step |
|---|---|---|
| Real video hosting | Bunny Stream account + library | docs/PROVIDERS.md §order 1 |
| Real AI | Azure OpenAI + Speech deployments, budget | §order 2 |
| CSAM / safety vendor | vendor contract | until then `SIGNUP_ENABLED=false` |
| Payments | Play's Razorpay keys; Lemon Squeezy store | KYC |
| YouTube connect | Google Cloud project, OAuth verification, quota | start now — weeks |
| App stores | Apple + Google developer accounts, EAS project; Expo SDK 58 upgrade first | V1.24 |
| Hosting | VPS 4, DNS for `*.play.klygenix.com`, origin certificate | docs/LAUNCH.md |
| Legal | terms, privacy, guidelines, grievance officer details (`[to be filled]` on the web) | lawyer review |
| Prices | plan prices are placeholders | owner |
| Commit | the whole tree is uncommitted | owner reviews and commits |

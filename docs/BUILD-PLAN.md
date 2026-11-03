# Klygenix Play — build plan and status

The master plan (`../Klygenix_Docs/Klygenix_Video/klygenix-video-master-plan.html`) says what and
why; this file says what is built, what each test proves, what runs only on sandbox providers and
what is blocked. Built in one unattended run, 3 Nov 2026. **Nothing is committed** (the owner
commits by hand) **and nothing is deployed.**

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

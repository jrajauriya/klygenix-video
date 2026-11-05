# Klygenix Play — security

Scans and checks for the Play repo, run locally on 3 Nov 2026. Nothing was deployed and no live
provider was called.

## What runs where

| Check | Command | CI job | Fails on |
|---|---|---|---|
| Secrets (tree + history) | `bash infra/security/secrets-scan.sh` (gitleaks v8.30.1 in Docker) | security | any leak; a secret file not gitignored |
| Python dependencies | `pip-audit -r backend/requirements.txt` | security | any known vulnerability |
| npm dependencies | `npm audit --omit=dev --audit-level=high` | security | high and above |
| Static analysis, Python | `bandit -q -r backend/app backend/scripts -ll` | security | medium and above |
| Static analysis, all | `bash infra/security/semgrep.sh` (owasp-top-ten, python, react, nginx, docker) | security | any finding |
| Authorization sweep | `tests/test_security.py` | backend | a private route answering a stranger |
| Tenancy (RLS) | `tests/test_tenancy.py` | backend | one tenant reading another's private rows |
| Error-tracking scrubber | `tests/test_error_tracking.py` | backend | PII reaching the fake Sentry |
| Headers and caching through nginx | `tests/smoke/post_deploy.py` | — (local stack, deploy) | missing HSTS/CSP/nosniff/frame options |

The scanners were installed in a throwaway virtualenv for the local run. CI pins the same versions.

## Results — 3 Nov 2026

| Scan | First run | After fixes |
|---|---|---|
| gitleaks, files git would commit (19.7 MB) | 0 leaks; secret files ignored and untracked | — |
| gitleaks, history | 0 commits (the tree is uncommitted) | rerun after the first commit |
| bandit, medium+ | 0 (21 low: subprocess for ffmpeg/ffprobe with argument lists, asserts in scripts) | — |
| semgrep | 0 findings, 262 rules, 501 files | — |
| pip-audit | 57: Pillow 12.3.0 (40), pypdf 6.19.0 (17) | **0** — Pillow 13.0.0, pypdf 6.21.4; clips (caption frames), images and invoices suites green after |
| npm audit, production, high+ | 5 high, all in the Expo toolchain (see below) | justified, not fixed |

### npm findings left open (dated, review by 31 Dec 2026)
All five high findings come from `apps/mobile`:
- `@expo/cli`, `@expo/config-plugins` and `zod`: these run at build time on the developer's machine, not in the app.
- `expo-router`, `query-string` and `decode-uri-component`: denial of service when parsing a crafted deep link, on the user's own phone.

The only fix is Expo SDK 58 (`npm audit fix --force`), which is a breaking upgrade of the whole mobile app. Nothing ships to the stores until the Apple and Google accounts exist. **Upgrade to SDK 58 before the first store build** and re-run `npx expo export` and `test_native_imports.py`. None of these packages reach the web, studio or admin bundles.

## Play-specific controls

| Rule | Control | Proven by |
|---|---|---|
| V01 media is never public | Bunny token-auth HLS (sandbox: HMAC-signed `/sandbox/hls/{id}/{exp}/{sig}`), minutes-long expiry; private uploads volume | `test_upload_flow.py` (expired / forged signature refused) |
| V02 no AI on media we do not host or own captions for | embeds run AI only on owner-imported captions; no adapter has a download path | `test_embed_policy.py` |
| V03 Ask cites or declines | citation guard drops citations outside retrieved segments or the video's span | `test_ask_citations.py` |
| V05 quota before work | reserve → commit / release around Ask, the pipeline and render | `test_quota.py`, `test_plans_billing.py` |
| V08 nothing public before the scan | upload → scanning → published or in_review/blocked | `test_moderation.py` |
| V13 age gate on the server | 18 India, 16 parts of the EU, 13 elsewhere; checked at sign-up | `test_accounts.py` |
| Webhooks verify → record → enqueue | media and payment webhooks; unsigned ones stored as evidence, refused | `test_upload_flow.py`, `test_plans_billing.py` |
| Grants only from a verified payment | entitlement written by the payments worker; `/sandbox/pay` exists only with `SANDBOX_ENABLED` | `test_plans_billing.py` |
| Data rights (DPDP) | `POST /me/export`, `DELETE /me` (audited; invoices kept for tax); export and erase cover live chat and the push log (run 3) | `test_viewer_extras.py`, `test_live.py` |
| Live ingest only with the stream key | `live/gate.py` reads the RTMP `publish` name on the public port and compares it with `hmac.compare_digest` before forwarding to ffmpeg on loopback; keys sealed at rest, hashed for lookup, rotatable while not live | `test_live.py` (wrong key never goes live) |
| Live playback signed | `/sandbox/live/{id}/{exp}/{sig}/…`, HMAC with expiry (10-minute buckets); members-only streams get no playback | `test_live.py`, `test_security.py` (SIGNED prefix) |
| Browser go-live | `/ws/live/{id}/ingest` needs a short-lived signed ticket from the owning studio | `test_live.py` |
| Live chat abuse | run-1 filter, slow mode and per-user timeouts in Redis, channel moderators; timeouts by `message_id`, so user ids are not published | `test_live.py` |
| Audit attribution | platform admin routes record the admin (and IP); background work is `system`; nested before/after kept as JSON with secrets fingerprinted | `test_admin_ops.py` |
| Data retention | sweep: Ask history 365 d, push log 90 d, live chat 90 d after the stream, translations 180 d, leftover deleted media 30 d; never-started live streams closed after 24 h | `test_retention.py` |
| Studio inbox / analytics across tenants | queries in a platform session always filter `Video.tenant_id == ctx.tenant_id` | `test_viewer_extras.py` (another creator sees nothing) |
| Cloudflare Stream webhooks (run 4) | Stream webhook: `Webhook-Signature` HMAC-SHA256 over `time.body`, 5-minute tolerance; Notifications: `cf-webhook-auth` secret compared in constant time; unverified bodies kept as evidence and refused; playback via RS256 signed tokens (4 h) | `test_live_cloudflare.py`, `test_provider_contracts.py` |
| Every real adapter pinned (run 4) | Bunny, Cloudflare, Expo, YouTube, Instagram, Razorpay/Route, Lemon Squeezy, Azure OpenAI/Speech/TTS, scan vendor — request shape, auth headers, signature checks and error mapping against fakes of their documented APIs; secrets for Instagram, Expo, TTS and Cloudflare now decrypt from `enc:` values | `test_provider_contracts.py` |
| Closed beta (run 4) | `SIGNUP_MODE` / `CREATOR_SIGNUP`; invite codes stored as SHA-256 only (shown once), use counted atomically, optional email binding, revocable; waitlist answers 202 for every address (no enumeration) and confirms by a one-time hashed token | `test_trust_beta.py` |
| Ad events (run 4) | a decision mints a random impression token kept in Redis for 3 h; each event counts once per token, nothing before `start`; frequency caps per viewer (hashed IP for anonymous), budget and daily caps checked before serving; never on embeds, reels, members-only/paid videos, own videos or for Premium viewers | `test_ads.py` |
| Sponsorship escrow (run 4) | the creator's Route transfer is held until the brand approves (or 7 days after delivery); disputes resolved by an admin (release or refund through the one refund path); the deliverable gets a server-set "Paid partnership" label | `test_sponsorships.py` |
| TV device sign-in (run 4) | RFC 8628 shape: 8-character code from an unambiguous alphabet, 10-minute expiry, device code stored hashed, one approval by a signed-in viewer, token handed out once, `slow_down` on fast polling, per-IP limit on new codes | `test_device_login.py` |
| Ad integrity (run 5) | billing on a viewability event (`q0`, ≥ 2 s after `start`), same viewer key as the decision, declared bots refused, data-centre CIDRs (`ADS_IVT_CIDRS`) and per-IP/per-user bursts marked invalid, completes faster than half the ad refused; invalid traffic is never billed nor shared with creators | `test_ads.py` |
| Downloads (run 5) | Premium-only, signed 6-hour MP4 links (sandbox HMAC route / Bunny token), 30-day licences bound to the viewer (HMAC over user, video, expiry) re-checked online; embeds and locked videos refused | `test_viewer_growth.py` |
| Regions (run 5) | accounts pinned to a home region; with `REGION_ENFORCE` the other host refuses sign-up and sign-in; no cross-region joins | `test_view_pool.py`, `tests/smoke/region_rehearsal.py` |
| Channel teams (run 6) | members act in a channel only through `X-Kv-Tenant` checked against an active membership on every studio request; role levels from the channel's own matrix; billing and earnings owner-only whatever the matrix says; members cannot rename the handle or change their own role; API keys and support sessions cannot act as members; invitations are single-use hashed tokens bound to the invitee's email, 7-day expiry; every invite / accept / role change / removal audited with the member and channel in the actor label | `test_teams.py` |
| Support desk (run 6) | `admin.support` key; lookups and timelines read through a platform session; sign-out bumps `session_epoch`; support sessions are read-only (any non-GET with an `imp` claim is refused), expire after `IMPERSONATION_MINUTES`, can be ended, never target the admin's own account or a global admin; every desk action audited with a reason | `test_support_desk.py` |
| Handle reservations (run 6) | an old handle stays reserved for 180 days and redirects; renames limited to one per 30 days and audited | `test_onboarding.py` |
| Partition upkeep (run 6) | the app role cannot create, attach or drop tables; `kv_admin.maintain_partitions()` is SECURITY DEFINER with a fixed search path, accepts only the two partitioned tables and is the only EXECUTE grant | `test_retention.py` |
| Tracing (run 6) | off unless an OTLP endpoint is set; spans carry method, route, status and model names — no bodies, tokens or query strings; collector headers can be sealed `enc:` values | `test_tracing.py` |
| Error codes (run 7) | every refusal names its message id (`code`, `X-Error-Code`) — ids only, never values, stack traces or SQL | `test_teams.py` |
| Team moderation (run 7) | deleting another viewer's comment or danmaku and moderating live chat need the channel owner, a channel moderator, or a team member whose role reaches `video.comments` / `video.live` at "full" (`teams.can_act`) | `test_teams.py` |
| Channel notices (run 8) | moderation notices, strikes and takedowns of a channel are readable by its owner and by team members whose role reaches `video.comments` (view); appeals need "full"; a counter-notice is a sworn statement in the owner's name, so members get 403 `owner_only` and `can_counter` is false for them; without `X-Kv-Tenant` a member sees only their own account | `test_teams.py` |
| App links (run 8) | nginx serves `apple-app-site-association` / `assetlinks.json` only when `APPLE_TEAM_ID` is a 10-character Team ID and `ANDROID_CERT_SHA256` holds well-formed SHA-256 fingerprints, otherwise 404; the app maps incoming links to a fixed set of screens (watch, reels, live, channel, team invite) and anything else to the feed; invite tokens stay single-use and email-bound | `test_app_links.py`, stack smoke |
| Counter-notices (run 4) | only the uploader of the removed video, sworn statements and a typed signature required; forwarded to the claimant; restore after 10 business days unless an admin records a court action | `test_trust_beta.py` |

## Debug routes

`/api/_debug/*` (deliberate failures for the error-tracking checks) is mounted only when
`ERROR_TRACKING_DEBUG_ROUTES=true` **and** `SANDBOX_ENABLED=true`. `tests/test_security.py` asserts
it is 404 to everyone otherwise.

## Browser error reports

Front-end errors go to Sentry only when `VITE_SENTRY_DSN` is set at build (`packages/observe`), and
by default through our own `POST /api/observe/tunnel`, which forwards only to the configured DSN
after the server-side scrubber has run (`tests/test_error_tracking.py`, 72 checks). No tracker
origin is in any CSP.

## Allowlists

| File | Entry | Reason | Review |
|---|---|---|---|
| inline | `# nosec B608 nosemgrep` in `core/services/secrets.py`, `scripts/manage_secrets.py`; `# nosec B104` in `core/services/readiness.py` | identifiers come from a fixed table list / the bind check looks for 0.0.0.0 | — |
| `infra/security/semgrep.sh` | nginx `request-host-used`, `dynamic-proxy-host` | `server_name`s are fixed by `${PUBLIC_DOMAIN}` at container start | when nginx gains a new `map` |
| npm (this file) | five Expo-toolchain highs | see above | 31 Dec 2026 |
| `.gitleaks.toml` | the exact phrase "Route keys, ASCI/advertiser policy text" in `docs/BUILD-PLAN.md` | gitleaks' generic-api-key rule read run-4 prose (already in commit `d1ba83c`) as a key; the entry matches that phrase only | — |

Development defaults that look like secrets are fake and are blocked in production by
`python -m app.readiness`: `SECRET_KEY=dev-secret-key-change-in-production`, `GLOBAL_ADMIN_PASSWORD=admin123`,
the sandbox webhook secret, the `klygenix_video`/`klygenix_video_app` database passwords, `Welcome@12345`
(demo seed only) and every `CHANGE_ME_*`.

## Remaining risks

1. **Signed media URLs can be shared while they live.** A playback URL works for anyone until it
   expires (`PLAYBACK_TTL_SECONDS`). Fine for public videos; for paid or private content later, add
   Bunny's IP/referrer binding.
2. **The sandbox safety scanner is a keyword and hash list.** Real CSAM hash matching and a content
   classifier are vendor accounts (docs/LAUNCH.md). Until then, **creator uploads should stay
   closed or pre-moderated** (`SIGNUP_ENABLED=false`, or every upload to `in_review`).
3. **Unsigned webhook bodies are stored as evidence** in `kv_commerce.provider_events`; nginx caps
   the body size, but add a `limit_req` zone on `/api/video/webhooks/` before launch.
4. **Tokens live in `localStorage`** (web, studio, admin). A strict `script-src` is the mitigation;
   tokens are revocable by session epoch; account erasure bumps it.
5. **YouTube OAuth tokens** are sealed (`enc:`) in `kv_social.connected_channels`; the key file is
   the single point — back it up with the database (docs/ROTATION in infra).
6. **The real edge was not scanned.** Cloudflare and the Hostinger host don't exist yet.
7. **Live chat and streams cannot be reported** through `/reports` yet (only in-room moderation by the
   creator and moderators, and the platform stop). Add `live_message` / `live` report targets before launch.
8. **Instagram long-lived tokens** are sealed like YouTube's; they expire after 60 days and need a refresh job
   before the live Instagram adapter is switched on.
9. **ZAP was not run** for Play tonight (`infra/security/zap.sh` still targets the old preview
   layout); authenticated behaviour is covered by `test_security.py` and `test_tenancy.py`.

# Klygenix Play — deployment plan (closed beta)

Decided 9 Nov 2026. `LAUNCH.md` is the step-by-step checklist and `GO-LIVE.md` the per-provider routine; this file
records the choices and the order. Nothing here is deployed until the owner says go.

## Choices

| Item | Choice | Billed |
|---|---|---|
| Domain | `play.klygenix.com` · `play-studio.` · `play-admin.` · `play-api.` · `play-tv.klygenix.com` — flat, like Store and Insurance (`HOST_STYLE=flat`), so Universal SSL covers them (`klygenix.ai` is Insurance's) | — |
| Server | **New Hostinger KVM 4, Mumbai** (4 vCPU / 16 GB / 200 GB, Ubuntu 24.04), Play only. The KVM 2 (estate) and the KVM 4 (Insurance + Store) stay as they are | ₹, ~₹1,099/mo intro, ~₹2,399 renewal |
| Edge | Existing Cloudflare account, `klygenix.com` zone, proxied A records, Full (strict), WebSockets on, Access on `admin.` | Free plan |
| TLS | Universal SSL at the edge (flat hosts, no ACM); a Cloudflare origin certificate for the five hosts on the server | ₹0 |
| Videos | **Bunny Stream** (prepaid wallet, card or PayPal) | $, ~$10–40/mo in beta |
| Live | **Off at launch.** No Cloudflare Stream; going live answers "Live streaming is not switched on yet". Readiness only warns | ₹0 |
| Files + backups | **Cloudflare R2**, two private buckets (`klygenix-play-files`, `klygenix-play-backups`), as Store does | $, ~$0–2/mo |
| AI | **Klydo's Azure resources** (same keys as Insurance), Azure Sponsorship subscription | Azure credits |
| Payments | Klygenix's Razorpay account (live since Store, 8 Nov) with Play's site added; Premium only. Creator money waits for the CA | % per payment |
| Mail | SMTP as Insurance (`contact@klygenix.com`) | ₹0 |

Expected beta bill: **~₹1,100 + ~$10–40 a month**, AI on Azure credits.

## AI settings (from `az`, 9 Nov 2026)

| Use | Resource | Deployment | Settings |
|---|---|---|---|
| Ask, summaries, chapters, translation | `aoai-klydo-platform` (centralus) | `gpt-5.6-luna` | `LLM_PROVIDER=azure_openai`, `LLM_BASE_URL=https://aoai-klydo-platform.openai.azure.com/openai/v1/responses`, `LLM_MODEL=gpt-5.6-luna`, **`LLM_MODEL_FAST=gpt-5.6-luna`** |
| Budget gate | — | — | `LLM_INPUT_COST_PER_MTOK_MINOR=1760`, `LLM_OUTPUT_COST_PER_MTOK_MINOR=10560` ($0.20 / $1.20 per M tokens at ₹88/$), `LLM_MONTHLY_BUDGET_MINOR=500000` (₹5,000) |
| Search and Ask vectors | `aoai-klydo-platform` | **`text-embedding-3-small` — to be added** (only `-large` exists) | `EMBED_PROVIDER=azure_openai`, `EMBED_URL=https://aoai-klydo-platform.openai.azure.com/openai/v1/embeddings`, `EMBED_MODEL=text-embedding-3-small`, `EMBED_DIM=1536` |
| Transcripts (EN + HI) | `aif-klydo-platform` (AI Services, centralus) | Speech (built in) | `STT_PROVIDER=azure_speech`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION=centralus` |
| Dubbing | `aif-klydo-platform` | Speech (built in) | `TTS_PROVIDER=azure`, `AZURE_TTS_KEY`, `AZURE_TTS_REGION=centralus` |
| AI thumbnails | — | none | `IMAGE_PROVIDER=sandbox`: frames + title drawn locally by Pillow, no cost |

`gpt-5.4-mini` is not used: it costs more than `gpt-5.6-luna` ($0.75 / $4.50 vs $0.20 / $1.20 per M tokens, Azure
retail prices, Global Standard). Keys are sealed with **Play's own** master key; Insurance's `enc:` values cannot be
copied across. The shared deployments share Klydo's quota (luna 1,000 K TPM); every Play call is still costed in
`kv_ai.llm_calls`. Audio for transcripts is processed in Central US.

## What blocks readiness today

`deploy.sh` stops on these (`python -m app.readiness --env-file .env.prod`):

| Check | Closed by |
|---|---|
| `video.provider` | Bunny library, token auth, MP4 fallback, webhook |
| `stt.provider` | Azure Speech key above |
| `storage.s3` | R2 bucket + a key limited to it |
| `payment.rail`, `razorpay.keys`, `razorpay.live` | Razorpay live keys, Play's webhook |
| `email.config` | SMTP settings |
| `platform.identity` | Admin → Accounts → Klygenix Technologies: legal name, address, GSTIN, support email, grievance officer |
| `scan.provider` | **No vendor yet** — see D2 |
| secrets, admin password, CORS, metrics token | written during step 3 |

## Progress (9 Nov 2026)

| Done | Detail |
|---|---|
| Server | Hostinger KVM 4 `srv2142501.hstgr.cloud`, **189.72.147.237**, India, Ubuntu 24.04 (expires 2028-11-09). `infra/server-setup.sh --cloudflare-only` run: Docker 29.9, ufw + 80/443 from Cloudflare only, SSH keys only, 4 GB swap. Master key, origin certificate and compose env are on the host |
| Secrets folder | `ERP/IntellixAI/hostinger/vps3-kvm4-play/` (mode 700): `play.env.prod` (sealed with `play.secret.key`), `play-infra.env`, `admin.txt`, `razorpay-webhook.txt`, `bunny.env` and `r2.env` (to fill), `origin.pem` / `origin-key.pem` |
| Azure | `text-embedding-3-small` deployed on `aoai-klydo-platform`. Live: Responses (`gpt-5.6-luna`) ok, embeddings 1536 ok, Speech (Hindi, centralus) ok, Content Safety ok |
| Razorpay | Live key read ok |
| Cloudflare | Proxied A records `play`, `play-studio`, `play-admin`, `play-api`, `play-tv` → 189.72.147.237. R2 buckets `klygenix-play-files`, `klygenix-play-backups` (APAC). Origin certificate for the five hosts (to 2041) from a local key (`origin-nested-unused.pem` was issued first for `*.play.klygenix.com` and is not used). Zone SSL mode is Full (automatic), not strict — making the zone strict would also apply to the estate's `hr.` / `rental.` hosts; a per-host Configuration Rule can make Play strict later |
| Code | D1 `infra/server-setup.sh`, D2 Content Safety scan (frames + text), D3 Live menu hidden while live is off; speech retries 429/503; `providers_check --env-file --live` now probes the file's settings; `HOST_STYLE` (`infra/nginx/hosts.sh`, `Settings.public_host`, Expo `EXPO_PUBLIC_HOST_STYLE`); production builds every app through `build-web.sh` (TV had no API URL, web's studio link fell back to localhost); `deploy.sh` now uploads `applinks.sh` and `hosts.sh` (nginx would not have started) |
| Rehearsal | Staging deploy on the VPS with sandbox providers (BUILD-PLAN R10.12): smoke 161/0, 200/200 WebSockets, 0 errors. Found and fixed on the way: the firewall dropped containers' outbound HTTP (R10.10), the smoke test's nested hosts (R10.11) |

## Deployed (10 Nov 2026)

Production is live on **189.72.147.237** behind Cloudflare: `play.klygenix.com`, `play-studio.`, `play-admin.`, `play-api.`,
`play-tv.klygenix.com`. The rehearsal stack is removed.

| Area | State |
|---|---|
| Stack | backend (4 workers), worker-ai, worker-render, scheduler, nginx, Postgres 17 + pgvector, Redis. Readiness: 0 blocking, 8 warnings (all deliberately off for beta) |
| Edge | Direct IP 80/443 refused; `/metrics` 403 without the token; Cache Rule "Play service worker never cached" (only `/sw.js` on the four app hosts) |
| Video | Bunny library `klygenix-play` (804803): Frankfurt + Singapore/US replicas, CDN token auth **on**, direct play **off**, referrer blocking **off** (the app and the server send no referrer; signed URLs protect), MP4 fallback on, Early-Play off. Webhook `https://play-api.klygenix.com/api/video/webhooks/media/bunny?secret=…` saved |
| Files | R2 token `klygenix-play-app` (files bucket only) in `.env.prod`; token `klygenix-play-backups` (backups bucket only) in `/opt/klygenix-video/infra/backup.env` — each refused on the other bucket |
| Backups | `/etc/cron.d/klygenix-video`: base backup 02:30, dump + ship to R2 03:00, WAL metrics every 5 min. First base + dump shipped and deep-verified (5/5). PITR rehearsal 9/9, 106 tables |
| Payments | Razorpay live keys; webhook `https://play-api.klygenix.com/api/video/webhooks/payments/razorpay`, 10 events, Play's own secret (Store's and Payhip's webhooks untouched; neither app acts on the other's events) |
| Checked | Smoke **98/0**; real uploads through Bunny (TUS → webhook → Azure Speech → Content Safety → published) for an English and a Hindi video; signed playback (403 without token); Ask cites timestamps in English and Hindi; outside load through Cloudflare 100 viewers + 200 WebSockets: 0 errors, 200/200 sockets, server ~96% of requests ≤100 ms |
| Test videos | Two **unlisted** videos on the `klygenix` channel ("Deploy check: …", ids `o5BeMnVGz3v`, `63tnS9usCVC`) — delete them from the studio when no longer needed |

### Content (12 Nov 2026)
| What | State |
|---|---|
| `@klygenix` | 12 company demos (DMS, HR, Pay, channel intro; EN + HI) from `Klygenix_Docs/Demo_Videos`, public, owner's own thumbnails and `.srt` captions; Ask cites timestamps. Complimentary **Creator Business** (grant, ends 12 Dec 2026) for the AI minutes |
| `@klygenixbuzz` | New channel (contact@klygenix.com, login in `vps3-kvm4-play/klygenix-buzz.txt`). 30 reels from the Etsy "244 Talking Food & Body Facts" pack, all marked AI-made: **13 public** (household/kitchen tips, cobra facts), **17 unlisted for owner review** — diet and medical claims, swearing, a Coca-Cola can |
| Not used | `50 Short Videos.zip` (filenames show it was downloaded from an Instagram account); rust and ASMR packs |
| Workers | `worker-ai` runs 3 replicas (R10.25); three jobs cut off by a restart were re-queued by hand |

### Waiting on the owner
1. **Company details** — `https://play-admin.klygenix.com` → Accounts → Klygenix Technologies → **Company** tab: address, GSTIN, support email (today it shows `admin@klygenix.com`), phone, CIN, privacy/legal emails, grievance officer. The legal pages fill these in automatically.
2. **Legal review** of `/legal/*` — about 45 yellow placeholders are decisions (refund rule, notice period, liability cap, jurisdiction, TCS/TDS with the CA…). Remove the draft banner after review.
3. **Razorpay website** — submit `https://play.klygenix.com` (Account & Settings → Websites & API keys → Add additional website/app) **after** 1 and 2; reviewers check for live Terms, Privacy, Refunds & cancellations and Contact pages without placeholders.
4. **₹149 test purchase** with your own card, then refund it from Admin → Money.
5. First creators: invite codes from Admin → Beta (sign-up and channels are invite-only).

## Order

**1. Owner — accounts (no code)**
1. Buy the KVM 4 (Mumbai, Ubuntu 24.04).
2. Cloudflare: an origin certificate for the five Play hosts; two R2 buckets
   and an API token scoped to them.
3. Bunny: account, top up $20, one Stream library (token authentication on, MP4 fallback 720p on).
4. Razorpay: add `play.klygenix.com` as a website (needs Razorpay's approval).
5. Azure: add a `text-embedding-3-small` deployment on `aoai-klydo-platform` (or let Claude run the one `az` command).
6. Decide the safety-scan route (D2).

**2. Claude — development before the deploy (each needs the owner's go-ahead)**
- **D1** `infra/server-setup.sh` for Play (port of Store's: Docker, firewall 22 for team IPs and 80/443 for Cloudflare
  ranges only, swap, unattended upgrades, backup dirs owned by uid 999).
- **D2** Safety scan. Readiness refuses a public upload platform without one. Proposal: an **Azure AI Content Safety**
  adapter on `aif-klydo-platform` (frames + text, already paid by the same resource) plus a request for Microsoft
  **PhotoDNA** (free for qualifying platforms) for hash matching. Until hash matching exists, creators stay invite-only.
- **D3** (optional) Hide the studio's Live menu while `LIVE_PROVIDER` is not `cloudflare`.

**3. Claude + owner — env and checks (local, nothing deployed)**
1. Fresh master key for Play; seal every secret into `backend/.env.prod` and `infra/.env` (never committed).
2. `SANDBOX_ENABLED=false`, `JOBS_MODE=rq`, `SIGNUP_MODE=invite`, `CREATOR_SIGNUP=invite`, `LIVE_PROVIDER=sandbox`,
   `PUBLIC_DOMAIN=play.klygenix.com`.
3. `make -C infra providers-check ENV_FILE=../backend/.env.prod`, then the one `--live` probe per provider (owner's go-ahead).
4. `python -m app.readiness --env-file .env.prod` → no blockers.

**4. Deploy (owner's go-ahead)**
1. DNS: four proxied A records → the new server's IP.
2. `bash infra/deploy.sh --dry-run`, then `VPS_HOST=root@<ip> bash infra/deploy.sh`.
3. Register webhooks: Bunny (`/api/video/webhooks/media/bunny?secret=…`), Razorpay (`/api/video/webhooks/payments/razorpay`).
4. Check: `bash infra/local-stack.sh smoke` against the live host, a 10 s upload reaches `published`, an Ask answer
   cites timestamps, a ₹149 Premium purchase and its refund, a 200-socket load run from outside (run 9's fix on real hardware).
5. Backups: first base backup to R2, then `infra/pitr-rehearse.sh` once.

**5. Closed beta**
Invite creators by hand; watch Admin → AI usage, Bunny's bill and the readiness page weekly.

**6. Later, one at a time**
Cloudflare Stream (live) · Razorpay Route for creator money (after CA sign-off and creator KYC) · YouTube / Instagram
OAuth · Expo push and store builds (Apple $99/yr, Google $25 once, Team ID + fingerprint for app links) · Lemon
Squeezy · R2 video provider if Bunny passes ~$100/mo · US server.

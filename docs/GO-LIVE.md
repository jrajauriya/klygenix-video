# Going live with real providers

Every provider runs on a sandbox adapter until its keys are set. Each real adapter is pinned by a contract test against
a fake of its documented API (`tests/test_provider_contracts.py`, `tests/test_live_cloudflare.py`), so switching one on
should only need the keys below. Do one provider at a time on staging first.

**The routine for each provider**
1. Open the account; create the key with the least scope listed.
2. Seal each secret: `cd backend && ./venv/bin/python scripts/manage_secrets.py seal` → paste the `enc:` value into
   `backend/.env.prod` (never commit it).
3. Register the webhook URL printed by the check (`make -C infra providers-check ENV_FILE=../backend/.env.prod`).
4. Run the one live probe: `cd backend && ./venv/bin/python -m app.providers_check --env-file .env.prod --live`
   (one harmless read per provider; the build never runs it).
5. `python -m app.readiness --env-file .env.prod` must show no blockers.
6. **Roll back** = set the provider switch back to `sandbox` and restart; nothing else changes.

| Provider | Switch | Keys | Webhook | First real check |
|---|---|---|---|---|
| Bunny Stream | `VIDEO_PROVIDER=bunny` | `BUNNY_LIBRARY_ID`, `BUNNY_API_KEY` (library key), `BUNNY_CDN_HOST`, `BUNNY_TOKEN_KEY` (token auth on — needed for paid and members-only videos), `BUNNY_WEBHOOK_SECRET` (any long random string) | `https://play-api.klygenix.com/api/video/webhooks/media/bunny?secret=<BUNNY_WEBHOOK_SECRET>` | Upload a 10 s clip from the studio; it must reach `published`. Enable MP4 fallback (720p) in the library — the AI pipeline reads it. In Security: CDN token authentication **on**, direct play **off** (otherwise paid videos play on Bunny's own page), block direct URL access **off** (the app and the server send no referrer). **Check once:** the Fetch Video response carries the new video's id (`ingest_url` relies on `id`/`guid`; Cloudflare replays use it) |
| Cloudflare Stream Live | `LIVE_PROVIDER=cloudflare`, `LIVE_WORKER_INLINE=false`, no `live` service | `CF_ACCOUNT_ID`, `CF_STREAM_TOKEN` (Stream:Edit), `CF_STREAM_CUSTOMER_HOST` (`customer-<code>.cloudflarestream.com`), `CF_STREAM_SIGNING_KEY_ID` + `CF_STREAM_SIGNING_KEY` (the `id` and base64 `pem` from `POST /accounts/{id}/stream/keys`), `CF_STREAM_WEBHOOK_SECRET` (returned by `PUT /accounts/{id}/stream/webhook`), `CF_NOTIFY_SECRET` | Both to `https://play-api.klygenix.com/api/video/webhooks/cloudflare-live`: the Stream webhook (recording ready, signed `Webhook-Signature`) and a Notifications webhook destination with the secret, subscribed to **Stream Live Input** (connected / disconnected / errored) | Go live from OBS with the RTMPS URL and key the studio shows; the watch page plays within ~10 s; end the stream; the replay imports into Bunny and publishes |
| Azure OpenAI | `LLM_PROVIDER=azure`, `EMBED_PROVIDER=azure` | `LLM_BASE_URL` (…/openai/v1/responses), `LLM_API_KEY`, `LLM_MODEL`, `LLM_MODEL_FAST`, `EMBED_URL`, token prices for the budget gate | — | Ask a video a question; the answer cites timestamps and `kv_ai.llm_calls` shows the cost |
| Speech to text | `STT_PROVIDER=azure_speech` (or `openai`) | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | — | Upload the Hindi fixture; the transcript is Hindi |
| Text to speech | `TTS_PROVIDER=azure` | `AZURE_TTS_KEY`, `AZURE_TTS_REGION` | — | Dub a short video with consent |
| Expo push | `PUSH_PROVIDER=expo` | `EXPO_ACCESS_TOKEN` (enhanced security on); APNs key and FCM credentials live in EAS (`eas credentials`) | — | Publish a video; the creator's phone gets "published". Receipts are checked every 15 min; dead tokens are dropped |
| YouTube | `YOUTUBE_PROVIDER=live`, `PUBLISH_PROVIDER=live` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_OAUTH_REDIRECT` | OAuth redirect `https://play-api.klygenix.com/api/video/channels/youtube/callback` | Connect a channel; import a video with captions; publish one clip as a Short (upload is untested live) |
| Instagram | `INSTAGRAM_PROVIDER=live` | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` (Meta app, Instagram API with Instagram Login; app review for `instagram_business_content_publish`) | OAuth redirect `https://play-api.klygenix.com/api/video/channels/instagram/callback` | Connect a professional account; publish a reel. Tokens refresh daily when within 10 days of expiry; expired ones show "reconnect" |
| Razorpay + Route | `PAYMENT_RAIL=razorpay` | `RAZORPAY_KEY_ID` (`rzp_live_…`), `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `ROUTE_PROFILE_CATEGORY`/`SUBCATEGORY` (confirm with Razorpay) | `https://play-api.klygenix.com/api/video/webhooks/payments/razorpay` | ₹1 test purchase of Premium, then refund it from admin. **Creator money only after CA sign-off** |
| Lemon Squeezy | `LEMONSQUEEZY_*` set | store id, variant id, API key, signing secret | `https://play-api.klygenix.com/api/video/webhooks/payments/lemonsqueezy` | A USD Premium purchase from outside India |
| Safety scan: Azure AI Content Safety | `SCAN_PROVIDER=azure_content_safety` | `SCAN_API_URL` (the AI Services endpoint, e.g. `https://<resource>.cognitiveservices.azure.com`), `SCAN_API_KEY` | — | `--live` sends one text call. Upload a clip: title, description, transcript (≤10,000 characters) and 6 frames are classified; severity ≥4 in any category → moderation queue, Sexual ≥6 → blocked. No hash matching: keep `CREATOR_SIGNUP=invite` until PhotoDNA (or another hash vendor) is added |
| Safety scan vendor (hash matching) | `SCAN_PROVIDER=<vendor>` | `SCAN_API_URL`, `SCAN_API_KEY` | — | Upload the review fixture; it lands in the moderation queue. Then open creator sign-up (`CREATOR_SIGNUP=open`) |
| Mail | Microsoft Graph | `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_SENDER` | — | `scripts/send_test_email.py`; then the waitlist confirmation mail |

**Never** run the sandbox `live` service on the production host, and never set `SANDBOX_ENABLED=true` there — readiness
refuses both.

## Run 5 providers and hosts

| Provider / host | Switch | Keys | First real check |
|---|---|---|---|
| Azure OpenAI images (AI thumbnails) | `IMAGE_PROVIDER=azure` | `IMAGE_API_URL` (…/images/generations?api-version=…), `IMAGE_API_KEY` | Generate AI thumbnails for one video; each batch counts 3 against `ai_images` |
| US host (V5.4) | a second VPS with `backend/.env.us.example` | its own DB, Redis, Bunny library (US), Lemon Squeezy; `REGION=us`, `REGION_ENFORCE=true`, `REGION_URLS` on **both** hosts | `tests/smoke/region_rehearsal.py --india https://api.play.klygenix.com --us https://api.us.play.klygenix.com` |
| Invalid-traffic ranges | `ADS_IVT_CIDRS` | data-centre CIDR list (from an IVT vendor when one is chosen) | Admin → Advertising → Invalid traffic shows `datacentre` |

## Run 6 providers and hosts

| Provider / host | Switch | Keys | First real check |
|---|---|---|---|
| Trace collector (optional) | `OTEL_EXPORTER_OTLP_ENDPOINT` (any OTLP/HTTP collector: Grafana Cloud, Honeycomb, an OpenTelemetry Collector) | `OTEL_EXPORTER_OTLP_HEADERS` (seal it if it carries an API key) | Open a watch page; one trace shows the request span, the `job …` spans it queued and any `llm responses` span |
| Slow-query report | `pg_stat_statements` is preloaded by `docker-compose.prod.yml` (needs a Postgres restart the first time) | — | `make -C infra slow-queries PG_CONTAINER=klygenix-video-postgres` after a day of traffic |

## Run 8 hosts and app links

| Provider / host | Switch | Keys | First real check |
|---|---|---|---|
| iOS Universal Links | `APPLE_TEAM_ID` in the compose env for nginx (`infra/.env`, `infra/.env.staging`) | the Apple Developer Team ID (10 characters); bundle id `com.klygenix.play` | `curl https://play.klygenix.com/.well-known/apple-app-site-association` answers JSON; Apple's AASA validator passes; tapping an invite mail on an iPhone with the app opens the accept screen |
| Android App Links | `ANDROID_CERT_SHA256` in the same env | the Play app signing key's SHA-256 fingerprint (Play Console → App integrity), plus the upload key's if you sideload test builds — comma-separated | `curl …/.well-known/assetlinks.json`; `adb shell pm verify-app-links --re-verify com.klygenix.play` then `adb shell pm get-app-links com.klygenix.play` shows both hosts `verified` |
| App build | `EXPO_PUBLIC_DOMAIN` (defaults to `play.klygenix.com`) when building with EAS | — | `npx expo config --type public` lists `applinks:` for the web and studio hosts and verified intent filters |

Until both values are set, the well-known paths answer 404 and links open the website as before.


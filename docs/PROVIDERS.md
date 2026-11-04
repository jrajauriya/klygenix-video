# Providers — sandbox to real

Every outside service sits behind one interface with a sandbox adapter (the default) and a real
one. The switch is `backend/.env.prod`; secrets there are sealed `enc:` values
(`python scripts/manage_secrets.py seal`). **Readiness refuses production while any switch is
still `sandbox`** (`python -m app.readiness`, the deploy gate). None of the real adapters has been
called against a live account yet: each is written to the provider's documented API and covered
by the sandbox path's tests only.

| Service | Switch | Keys | Sandbox does | Real adapter |
|---|---|---|---|---|
| Video hosting | `VIDEO_PROVIDER=bunny` | `BUNNY_LIBRARY_ID`, `BUNNY_API_KEY`, `BUNNY_TOKEN_KEY`, `BUNNY_CDN_HOST`, `BUNNY_WEBHOOK_SECRET` | PUT upload to the API, ffmpeg HLS 360p/720p + thumbnail on the render queue, a signed "encoded" webhook, HMAC-signed playback | `media/providers/bunny.py`: create video, TUS upload signature (`sha256(library + key + expiry + id)`), "encoded" webhook (status 3/4), token-auth HLS URL, MP4 fallback, delete |
| Speech to text | `STT_PROVIDER=azure_speech` or `openai` | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` · or `OPENAI_TRANSCRIBE_URL`, `OPENAI_TRANSCRIBE_KEY`; `STT_COST_PER_MIN_MINOR` | reads the fixture's embedded subtitle track; otherwise duration-based segments | `ai/stt.py`: Azure fast transcription / Whisper-compatible endpoint, word timings → segments |
| Language model | `LLM_PROVIDER=azure` | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_MODEL_FAST`, `LLM_*_COST_PER_MTOK_MINOR`, `LLM_MONTHLY_BUDGET_MINOR` | extractive stand-in: summary, chapters, title ideas, Ask from the retrieved segments | `ai/llm.py` (Insurance's client): Responses API, strict JSON, retries, breaker, monthly budget, every call costed in `kv_ai.llm_calls` |
| Embeddings | `EMBED_PROVIDER=azure` | `EMBED_URL`, `EMBED_MODEL` (`text-embedding-3-small`), `EMBED_DIM=1536` | hashed bag-of-words, 1536 dims | `ai/embed.py`; uses `LLM_API_KEY`. **After switching, run `/reprocess` (or a re-embed script) — sandbox vectors are not comparable.** |
| Safety scan | `SCAN_PROVIDER=<vendor>` | `SCAN_API_URL`, `SCAN_API_KEY` | `kv-test-block` / `kv-test-review` markers in title/description/transcript, plus `trust/hashlist.txt` | `trust/scan.py`: posts text + frames, reads `{verdict, labels, hash_match}`. **A CSAM hash-matching vendor is required before creator uploads open.** |
| YouTube | `YOUTUBE_PROVIDER=google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_OAUTH_REDIRECT=https://api.play.klygenix.com/api/video/channels/youtube/callback` | a fake channel `UCkvSandboxChannel00001-t{tenant}` with three videos and captions | `channels/youtube.py`: OAuth (`youtube.readonly`, `youtube.force-ssl`), own uploads, `captions.download`. Needs Google's OAuth verification and quota for `force-ssl`. |
| Payments, India | `PAYMENT_RAIL=razorpay` (or `auto`) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | `POST /api/video/sandbox/pay/{checkout}` sends a signed capture/failure webhook | `rails/razorpay.py` (Store's): order + Checkout, webhook signature, worker grants |
| Payments, abroad (MoR) | `LEMONSQUEEZY_API_KEY` set (any non-IN country) | `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_VARIANT_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET` | same sandbox rail | `rails/lemonsqueezy.py`: hosted checkout, `X-Signature` webhook; no GST invoice (the MoR is the seller) |
| Email | Admin → Email Config, or `MS_GRAPH_*`, or `SMTP_*` | as Store | reserved test domains never sent (`.example`, `.test`, `.invalid`) | `core/services/graph_mail.py` (contact@klygenix.com) |
| Push | `PUSH_PROVIDER=expo` (+ EAS project id in `apps/mobile/app.json`; APNs key and FCM credentials uploaded to EAS) | `EXPO_ACCESS_TOKEN` (optional, enables enhanced push security) | records each send in `kv_social.push_messages` with status `sent`, no network | `services/push.py`: Expo push API in batches of 100, prunes `DeviceNotRegistered` tokens; triggers: video published, clip rendered, followed channel live, membership about to lapse; per-user switches in `/me/notifications` |
| Live streaming | `LIVE_PROVIDER=cloudflare`, `LIVE_WORKER_INLINE=false` | `CF_ACCOUNT_ID`, `CF_STREAM_TOKEN` (Stream:Edit), `CF_STREAM_CUSTOMER_HOST` | the `live` worker (compose profile `sandbox-live`, `make -C infra live`): an RTMP gate per pool port (19350–19359) checks the stream key, ffmpeg writes 1 s HLS + a recording, replay goes through `ingest_file`; browser go-live over `/ws/live/{id}/ingest` | `live/cloudflare.py`: live input create/delete, playback URL, recordings — **written to the documented API, not yet wired into `live/service.py`** (create, ingest details, `connected`/`disconnected` webhooks and replay import are the remaining work). Readiness refuses production on `sandbox` |
| Creator payouts (Route) | `PAYMENT_RAIL=razorpay` (Route rides on the same key pair) | `RAZORPAY_KEY_ID/SECRET`, `ROUTE_PROFILE_CATEGORY`, `ROUTE_PROFILE_SUBCATEGORY` (Razorpay's business category for Play — **confirm with Razorpay**; empty = refused), `MARKETPLACE_RESERVE_BPS`, `MARKETPLACE_RESERVE_DAYS`, `REFUND_WINDOW_DAYS` | `SandboxRoute`: linked accounts activate on submit (a PAN starting `AAAAA` comes back "needs clarification"), transfers/releases/reversals return fake ids | `rails/route.py` (Store's): linked account + stakeholder + product, settlement bank, transfers with `on_hold_until`, release, reversal |
| Clip publishing | `PUBLISH_PROVIDER=live` | YouTube: the creator's connected channel (`youtube.force-ssl` covers upload) | records a fake external id | `studio/publishers.py`: YouTube resumable upload as a Short; Instagram REELS container → poll → `media_publish` on `graph.instagram.com` with the creator's connected account |
| Instagram connection | `INSTAGRAM_PROVIDER=live` | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`; redirect `https://api.play.klygenix.com/api/video/channels/instagram/callback` | a fake professional account `ig-sandbox-{tenant}` | `channels/instagram.py`: Instagram API with Instagram Login (`instagram_business_basic`, `instagram_business_content_publish`), short → long-lived token (sealed). **Needs Meta app review** for content publishing; creators need a professional (business or creator) account |
| Text to speech (AI dubbing) | `TTS_PROVIDER=azure` | `AZURE_TTS_KEY`, `AZURE_TTS_REGION` (Neural voices per language in `ai/tts.py`) | a short tone at each caption start, so sync is audible | `ai/tts.py`: Azure Speech REST with SSML; `media/dubbing.py` fits each line to its slot (atempo ≤ 2×) and joins them into one AAC track |
| Face tracking (clips) | `FACE_PROVIDER=opencv` | — (OpenCV Haar cascade in the image, `opencv-python-headless==4.14`) | follows the magenta test marker | `studio/faces.py`: largest face per sampled frame (4 fps), smoothed and simplified into crop keyframes |
| Off-host backups | `BACKUP_TARGET=s3://bucket/prefix` | `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`, `BACKUP_S3_REGION` (§22: S3 `ap-south-1`, versioned) or R2 | `BACKUP_TARGET=dir:/path` (rehearsal) | `backend/scripts/backup_ship.py` via `infra/backup-ship.sh`; `backup.sh` ships, deep-verifies and prunes nightly |

## Order to switch on
1. Bunny Stream (nothing plays without it), with `PLAYBACK_TTL_SECONDS` decided.
2. Azure OpenAI + embeddings + Speech (one Azure resource group; budget alert at 80%).
3. Safety vendor. **Until it is live, keep `CREATOR_SIGNUP=invite` (run 4: invite codes and a waitlist) or route every upload to review.**
4. Razorpay (Play's own key pair, not Store's), then Lemon Squeezy.
5. Google OAuth verification for YouTube (weeks; start early).
6. Creator money (Route) — **only after CA sign-off** on commission GST, TCS (s.52), TDS (194-O) and tips;
   creator KYC goes through Route's linked-account onboarding. Until then the sandbox rail is the only rail for
   tips, boosts, memberships and paid videos. Paid and members-only videos also need `BUNNY_TOKEN_KEY` set
   (without it Bunny playback URLs are public).
7. Azure TTS for dubbing; YouTube upload for Shorts (needs step 5); Instagram after a Meta app review.
8. Expo push: `eas init` for the project id, upload the APNs key and FCM service account to EAS, then `PUSH_PROVIDER=expo`.
9. Live: Cloudflare Stream account and token, a signing key, the Stream webhook and a Notifications destination
   (all in `docs/GO-LIVE.md`; wired and tested against a fake in run 4), then `LIVE_PROVIDER=cloudflare`. Never run the
   sandbox `live` profile on the production host (it runs ffmpeg there).
10. Product mail: `EMAIL_PROVIDER=graph` (or smtp) — waitlist, invites, notice receipts and deal events go through it;
    in dev and staging they are captured in `kv_admin.mail_outbox` (Admin → Beta → Outbox).

Run `make -C infra providers-check ENV_FILE=../backend/.env.prod` after each step; the `--live` probe is in `docs/GO-LIVE.md`.

After each: `python -m app.readiness`, then `tests/smoke/post_deploy.py --skip-purchase` against the host.

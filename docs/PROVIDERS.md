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
| Push | EAS project id in `apps/mobile/app.json` | — | no-op without a project id | Expo push service; tokens in `kv_social.device_tokens` |

## Order to switch on
1. Bunny Stream (nothing plays without it), with `PLAYBACK_TTL_SECONDS` decided.
2. Azure OpenAI + embeddings + Speech (one Azure resource group; budget alert at 80%).
3. Safety vendor. **Until it is live, keep `SIGNUP_ENABLED=false` (Klygenix's own channel only) or route every upload to review.**
4. Razorpay (Play's own key pair, not Store's), then Lemon Squeezy.
5. Google OAuth verification for YouTube (weeks; start early).

After each: `python -m app.readiness`, then `tests/smoke/post_deploy.py --skip-purchase` against the host.

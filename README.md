# Klygenix Play

An AI video platform. Watch long videos and reels, ask a video a question and get an answer with
clickable timestamps, search inside what was said, and talk over the video with danmaku. Creators
upload or connect their own YouTube channel, get transcripts, chapters, summaries and clip ideas,
and turn a moment into a captioned 9:16 reel in one click.

A separate platform from the master estate, Pay, Store and Insurance, built on Store's
conventions. The plan is `../Klygenix_Docs/Klygenix_Video/klygenix-video-master-plan.html`;
`CLAUDE.md` is the working spec; `docs/BUILD-PLAN.md` says what is proven.

## Surfaces

| App | Dev | Production | Who |
|---|---|---|---|
| `apps/web` | http://localhost:5300 | play.klygenix.com | Viewers: home, reels, watch, search, channels, plans, account |
| `apps/studio` | http://localhost:5301 | studio.play.klygenix.com | Creators: uploads, video detail, clip maker, channel, analytics, billing |
| `apps/admin` | http://localhost:5302 | admin.play.klygenix.com | Klygenix: tenants, plans, moderation, takedowns, AI cost, readiness |
| `apps/mobile` | Metro :8082 | iOS / Android | Feed, Watch, Create, Profile (Expo) |
| API | http://localhost:9300 | api.play.klygenix.com | FastAPI + WebSocket; RQ workers `ai`, `render`, `default`; scheduler |

## Run it

```bash
docker compose -f infra/docker-compose.dev.yml up -d       # Postgres 17 + pgvector :25436, Redis :16383
cd backend && python3.11 -m venv venv && ./venv/bin/pip install -r requirements.txt
cp .env.example .env && ./venv/bin/python scripts/manage_secrets.py init
./venv/bin/alembic upgrade head
./venv/bin/uvicorn app.main:app --reload --port 9300
cd .. && npm install && npm run dev:web                     # and dev:studio, dev:admin, dev:mobile
python3 db-scripts/make_fixtures.py                         # five sample videos with speech (macOS `say` + ffmpeg)
backend/venv/bin/python db-scripts/seed-demo.py             # demo channels, viewers, processed videos
```

Every outside service runs on a **sandbox adapter** by default — video hosting, speech to text,
the language model, embeddings, the safety scan, YouTube and payments — so the whole product works
offline. `docs/PROVIDERS.md` says how to switch each to the real one.

Sign in: `admin@klygenix.com` / `admin123` (admin). Demo: `asha@demo.klygenix.com` (creator),
`rohan@demo.klygenix.com` (Premium viewer), password `Welcome@12345`.

## Test it

```bash
make -C infra test                                         # every API suite against the live API
node tests/e2e/run.mjs                                     # screens + accessibility, built bundles
bash infra/local-stack.sh up && bash infra/local-stack.sh smoke   # the production stack on play.localhost:8443
```

## Docs
`docs/BUILD-PLAN.md` (status) · `docs/LAUNCH.md` (go-live runbook) · `docs/PROVIDERS.md` ·
`docs/SECURITY.md` · `docs/API-GAPS.md` · `infra/METRICS.md` · `infra/BACKUPS.md`

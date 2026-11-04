.PHONY: dev db-up db-down api worker-ai worker-render scheduler live web studio admin mobile test fixtures seed providers-check slow-queries slow-queries-reset

db-up:
	docker compose -f docker-compose.dev.yml up -d

db-down:
	docker compose -f docker-compose.dev.yml down

api:
	cd ../backend && ./venv/bin/uvicorn app.main:app --reload --port 9300

worker-ai:
	cd ../backend && JOBS_MODE=rq ./venv/bin/rq worker --url redis://localhost:16383/0 -c app.video.jobs.rq_boot ai default

worker-render:
	cd ../backend && JOBS_MODE=rq ./venv/bin/rq worker --url redis://localhost:16383/0 -c app.video.jobs.rq_boot render

scheduler:
	cd ../backend && JOBS_MODE=rq ./venv/bin/python -m app.video.jobs.scheduler

live:
	cd ../backend && LIVE_WORKER_INLINE=false ./venv/bin/python -m app.video.live.worker

web:
	cd ../apps/web && npm run dev

studio:
	cd ../apps/studio && npm run dev

admin:
	cd ../apps/admin && npm run dev

mobile:
	cd ../apps/mobile && npm run start

fixtures:
	python3 ../db-scripts/make_fixtures.py

seed:
	../backend/venv/bin/python ../db-scripts/seed-demo.py

test:
	cd ../tests && for t in test_accounts test_tenancy test_upload_flow test_ai_pipeline test_search test_ask_citations \
	  test_quota test_social test_clips test_plans_billing test_moderation test_embed_policy test_security \
	  test_viewer_extras test_playlists test_parties test_thumbnails test_payouts test_monetisation test_refunds test_analytics_reco test_publishing test_community test_learning test_dubbing test_live test_push test_retention test_admin_ops test_readiness test_provider_contracts test_live_cloudflare test_trust_beta test_ads test_sponsorships test_reco_model test_device_login test_viewer_growth test_creator_ai test_view_pool test_teams test_onboarding test_support_desk test_tracing test_graph_mail test_error_tracking test_native_imports test_migration_parity; do \
	  echo "### $$t"; ../backend/venv/bin/python $$t.py || exit 1; done

slow-queries:
	docker exec $(or $(PG_CONTAINER),klygenix-video-postgres) psql -U $(or $(PG_USER),klygenix_video) -d $(or $(PG_DB),klygenix_video) -q \
	  -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" \
	  -c "SELECT calls, round(total_exec_time::numeric, 1) AS total_ms, round(mean_exec_time::numeric, 2) AS mean_ms, rows, \
	      left(regexp_replace(query, '\\s+', ' ', 'g'), 160) AS query FROM pg_stat_statements \
	      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) ORDER BY total_exec_time DESC LIMIT 20"

slow-queries-reset:
	docker exec $(or $(PG_CONTAINER),klygenix-video-postgres) psql -U $(or $(PG_USER),klygenix_video) -d $(or $(PG_DB),klygenix_video) -q \
	  -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" -c "SELECT pg_stat_statements_reset()"

providers-check:
	cd ../backend && ./venv/bin/python -m app.providers_check $(if $(ENV_FILE),--env-file $(ENV_FILE),)

dev: db-up
	@echo "Datastores up. Run 'make api', then 'npm run dev' at the root (web :5300, studio :5301, admin :5302)."

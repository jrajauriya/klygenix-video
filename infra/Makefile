.PHONY: dev db-up db-down api worker-ai worker-render scheduler web studio admin mobile test fixtures seed

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
	  test_viewer_extras test_playlists test_parties test_thumbnails test_payouts test_monetisation test_refunds test_analytics_reco test_publishing test_community test_learning test_dubbing test_readiness test_graph_mail test_error_tracking test_native_imports test_migration_parity; do \
	  echo "### $$t"; ../backend/venv/bin/python $$t.py || exit 1; done

dev: db-up
	@echo "Datastores up. Run 'make api', then 'npm run dev' at the root (web :5300, studio :5301, admin :5302)."

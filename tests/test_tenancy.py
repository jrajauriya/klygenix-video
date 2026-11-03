from sqlalchemy import create_engine, text

from harness import APP_DATABASE_URL, check, creator, finish, ok, settled, signup, upload

print("\n== Private content stays private")
a = creator("Tenant A")
b = creator("Tenant B")
v = upload(a, "reel-chai", "Private chai", visibility="private")
v = settled(a, v["id"])
check("private video processed", v["status"], "published")
pid = v["public_id"]
check("owner sees it on the watch endpoint", a.get(f"/api/video/videos/{pid}").status_code, 200)
check("another creator gets 404", b.get(f"/api/video/videos/{pid}").status_code, 404)
check("anonymous gets 404", signup("Anon").get(f"/api/video/videos/{pid}").status_code, 404)
check("transcript hidden from others", b.get(f"/api/video/videos/{pid}/transcript").status_code, 404)
check("B cannot edit A's video", b.patch(f"/api/video/studio/videos/{v['id']}", json={"title": "x"}).status_code, 404)
check("B cannot delete A's video", b.delete(f"/api/video/studio/videos/{v['id']}").status_code, 404)
ok("B's studio list does not include it", all(x["id"] != v["id"] for x in b.get("/api/video/studio/videos").json()))

print("\n== The database says the same (RLS, app role)")
eng = create_engine(APP_DATABASE_URL)
with eng.begin() as cx:
    cx.execute(text("select set_config('app.tenant_id', :t, true)"), {"t": str(b.user["tenant_id"])})
    seen = cx.execute(text("select count(*) from kv_media.videos where id=:i"), {"i": v["id"]}).scalar()
    segs = cx.execute(text("select count(*) from kv_ai.segments where video_id=:i"), {"i": v["id"]}).scalar()
check("app role as B sees 0 rows of A's private video", seen, 0)
check("app role as B sees 0 of its transcript segments", segs, 0)
with eng.begin() as cx:
    cx.execute(text("select set_config('app.tenant_id', :t, true)"), {"t": str(a.user["tenant_id"])})
    own = cx.execute(text("select count(*) from kv_media.videos where id=:i"), {"i": v["id"]}).scalar()
check("app role as A sees its own", own, 1)
with eng.begin() as cx:
    cx.execute(text("select set_config('app.tenant_id', :t, true)"), {"t": str(b.user["tenant_id"])})
    try:
        cx.execute(text("update kv_media.videos set title='hijack' where id=:i"), {"i": v["id"]})
        changed = cx.execute(text("select count(*) from kv_media.videos where title='hijack'")).scalar()
    except Exception:
        changed = 0
check("B's update of A's row touches nothing", changed, 0)
with eng.begin() as cx:
    try:
        cx.execute(text("update kv_ledger.journal_lines set debit_minor=1"))
        ledger_writable = True
    except Exception:
        ledger_writable = False
check("ledger is append-only for the app role", ledger_writable, False)

print("\n== Public content is readable by everyone")
a.patch(f"/api/video/studio/videos/{v['id']}", json={"visibility": "public"})
check("now public: B reads it", b.get(f"/api/video/videos/{pid}").status_code, 200)
check("now public: transcript readable", b.get(f"/api/video/videos/{pid}/transcript").status_code, 200)

finish()

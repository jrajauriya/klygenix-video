import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> int:
    from sqlalchemy import select

    from app.video.media.paths import work_dir
    from app.video.media.providers import provider
    from app.video.models.media import Video
    from app.video.pipeline.jobs import thumbnail_ideas
    from app.video.sessions import platform_session

    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    done = failed = 0
    with platform_session() as db:
        ids = db.execute(select(Video.id).where(
            Video.source != "embed", Video.status == "published", Video.is_deleted.is_(False),
            Video.ai_status == "ready", Video.thumbnail_ideas == []).order_by(Video.id).limit(limit)).scalars().all()
    for vid in ids:
        work = work_dir(f"thumbs{vid}")
        try:
            with platform_session() as db:
                v = db.get(Video, vid)
                src = os.path.join(work, "source")
                provider(v.provider).fetch_source(v, src)
                thumbnail_ideas(db, v, src, work)
                db.commit()
                done += 1
                print(f"  {v.public_id}: {len(v.thumbnail_ideas)} ideas")
        except Exception as exc:
            failed += 1
            print(f"  video {vid}: {type(exc).__name__}: {exc}")
        finally:
            shutil.rmtree(work, ignore_errors=True)
    print(f"{done} backfilled, {failed} failed, {len(ids)} considered")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

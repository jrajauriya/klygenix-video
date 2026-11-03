import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> int:
    from sqlalchemy import select

    from app.video.models.ai import VideoVector
    from app.video.models.media import Video
    from app.video.sessions import platform_session
    from app.video.social import reco

    with platform_session() as db:
        have = set(db.execute(select(VideoVector.video_id)).scalars().all())
        ids = [i for i in db.execute(select(Video.id).where(Video.status == "published", Video.is_deleted.is_(False))
                                     .order_by(Video.id)).scalars().all() if i not in have]
    done = 0
    for vid in ids:
        with platform_session() as db:
            reco.refresh_vector(db, db.get(Video, vid))
            db.commit()
            done += 1
    print(f"{done} video vectors written, {len(have)} already there")
    return 0


if __name__ == "__main__":
    sys.exit(main())

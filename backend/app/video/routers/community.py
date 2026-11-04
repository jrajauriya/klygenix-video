from __future__ import annotations

import hashlib
import json

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.ai import intel
from app.ai.captions import Cue
from app.ai.textkit import content_words, keywords
from app.core.messages import err
from app.core.models.user import User
from app.core.redis_client import get_redis
from app.video.models.ai import TextTranslation
from app.video.models.community import ChannelModerator, PollOption, PollVote, Post
from app.video.models.media import Video
from app.video.models.social import Channel, Comment, Danmaku
from app.video.present import iso
from app.video.realtime.rooms import publish
from app.video.routers.deps import Ctx, StudioCtx, Viewer, optional_viewer, signed_in, studio
from app.video.routers.support import my_rank
from app.video.routers.watch import LANGS, readable
from app.video.services import images
from app.video.sessions import platform_session
from app.video.services import handles

router = APIRouter(prefix="/api/video", tags=["community"])
SUMMARY_TTL = 3600
MIN_COMMENTS = 5


def post_out(db, p: Post, user=None, locked: bool = False) -> dict:
    out = {"id": p.id, "kind": p.kind, "body": "" if locked else p.body, "status": p.status,
           "image": None if locked or not p.image_key else images.public_url(p.image_key),
           "members_rank": p.members_rank, "locked": locked, "created_at": iso(p.created_at), "poll": None}
    if p.kind == "poll":
        opts = db.execute(select(PollOption).where(PollOption.post_id == p.id).order_by(PollOption.position)).scalars().all()
        counts = dict(db.execute(select(PollVote.option_id, func.count(PollVote.id)).where(PollVote.post_id == p.id)
                                 .group_by(PollVote.option_id)).all())
        mine = None
        if user is not None:
            mine = db.execute(select(PollVote.option_id).where(PollVote.post_id == p.id, PollVote.user_id == user.id)).scalar()
        total = sum(counts.values())
        out["poll"] = {"total": total, "my_vote": mine, "options": [
            {"id": o.id, "label": o.label, "votes": counts.get(o.id, 0)}
            for o in opts]}
    return out


@router.get("/channels/{handle}/posts")
def channel_posts(handle: str, limit: int = 20, offset: int = 0, viewer: Viewer = Depends(optional_viewer)):
    with platform_session() as db:
        ch = handles.resolve(db, handle)[0]
        if ch is None or ch.is_suspended:
            raise err(404, "channel_not_found")
        rows = db.execute(select(Post).where(Post.channel_id == ch.id, Post.status == "visible")
                          .order_by(Post.created_at.desc()).limit(min(limit, 50)).offset(offset)).scalars().all()
        owner = viewer.user is not None and viewer.user.tenant_id == ch.tenant_id
        rank = my_rank(db, viewer.user.id if viewer.user else None, ch.id)
        return [post_out(db, p, viewer.user, locked=bool(p.members_rank) and not owner and rank < p.members_rank) for p in rows]


class PostIn(BaseModel):
    kind: str = "text"
    body: str = Field(default="", max_length=3000)
    options: list[str] = Field(default_factory=list, max_length=6)
    members_rank: int | None = Field(default=None, ge=1, le=5)


def _new_post(ctx: StudioCtx, kind: str, body: str, options: list[str], members_rank: int | None,
              image_key: str | None = None) -> Post:
    from app.video.social.filter import clean, has_link

    if kind not in ("text", "poll", "image"):
        raise err(400, "action_not_allowed")
    ok, text = clean(body.strip())
    if not ok:
        raise err(400, "danmaku_blocked_words")
    if kind == "text" and not text:
        raise err(400, "comment_empty")
    labels = [o.strip()[:80] for o in options if o.strip()]
    if kind == "poll" and not 2 <= len(labels) <= 6:
        raise err(400, "action_not_allowed")
    p = Post(tenant_id=ctx.tenant_id, channel_id=ctx.channel.id, author_user_id=ctx.user.id, kind=kind, body=text,
             members_rank=members_rank, image_key=image_key, status="hidden" if has_link(text) and kind != "text" else "visible")
    ctx.db.add(p)
    ctx.db.flush()
    for i, label in enumerate(labels if kind == "poll" else []):
        ctx.db.add(PollOption(tenant_id=ctx.tenant_id, post_id=p.id, position=i, label=label))
    ctx.db.commit()
    return p


@router.post("/studio/posts", status_code=201)
def create_post(data: PostIn, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    if data.kind == "image":
        raise err(400, "action_not_allowed")
    p = _new_post(ctx, data.kind, data.body, data.options, data.members_rank)
    with platform_session() as db:
        return post_out(db, db.get(Post, p.id), ctx.user)


@router.post("/studio/posts/image", status_code=201)
async def create_image_post(file: UploadFile = File(...), body: str = Form(""), members_rank: int | None = Form(None),
                            ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    data = await file.read()
    try:
        key = images.save(data, max_side=1600)
    except images.ImageError:
        raise err(400, "image_unreadable")
    p = _new_post(ctx, "image", body, [], members_rank, key)
    with platform_session() as db:
        return post_out(db, db.get(Post, p.id), ctx.user)


@router.get("/studio/posts")
def studio_posts(ctx: StudioCtx = Depends(studio("video.channels"))):
    rows = ctx.db.execute(select(Post).where(Post.tenant_id == ctx.tenant_id, Post.status != "deleted")
                          .order_by(Post.created_at.desc()).limit(100)).scalars().all()
    with platform_session() as db:
        return [post_out(db, db.get(Post, p.id), ctx.user) for p in rows]


@router.delete("/studio/posts/{post_id}", status_code=204)
def delete_post(post_id: int, ctx: StudioCtx = Depends(studio("video.channels", "full"))):
    p = ctx.db.get(Post, post_id)
    if p is None or p.tenant_id != ctx.tenant_id:
        raise err(404, "action_not_allowed")
    p.status = "deleted"
    ctx.db.commit()
    return Response(status_code=204)


class VoteIn(BaseModel):
    option_id: int


@router.post("/posts/{post_id}/vote")
def vote(post_id: int, data: VoteIn, ctx: Ctx = Depends(signed_in)):
    with platform_session() as db:
        p = db.get(Post, post_id)
        if p is None or p.status != "visible" or p.kind != "poll":
            raise err(404, "action_not_allowed")
        if p.members_rank and my_rank(db, ctx.user.id, p.channel_id) < p.members_rank and ctx.user.tenant_id != p.tenant_id:
            raise err(402, "video_locked")
        opt = db.get(PollOption, data.option_id)
        if opt is None or opt.post_id != p.id:
            raise err(400, "action_not_allowed")
        if db.execute(select(PollVote.id).where(PollVote.post_id == p.id, PollVote.user_id == ctx.user.id)).first():
            raise err(409, "action_not_allowed")
        db.add(PollVote(tenant_id=ctx.tenant_id, post_id=p.id, option_id=opt.id, user_id=ctx.user.id))
        db.commit()
        return post_out(db, p, ctx.user)


def can_moderate(db, user, channel_id: int) -> bool:
    ch = db.get(Channel, channel_id)
    if ch is None:
        return False
    from app.core.services import teams

    if teams.can_act(db, user, ch.tenant_id, ("video.comments", "video.live")):
        return True
    return bool(db.execute(select(ChannelModerator.id).where(ChannelModerator.channel_id == channel_id,
                                                             ChannelModerator.user_id == user.id)).first())


class ModIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)


@router.get("/studio/moderators")
def list_mods(ctx: StudioCtx = Depends(studio("video.comments"))):
    rows = ctx.db.execute(select(ChannelModerator).where(ChannelModerator.channel_id == ctx.channel.id)).scalars().all()
    with platform_session() as db:
        users = {u.id: u for u in db.execute(select(User).where(User.id.in_([r.user_id for r in rows] or [0]))).scalars()}
        return [{"id": r.id, "user_id": r.user_id, "name": users[r.user_id].name if r.user_id in users else "",
                 "email": users[r.user_id].email if r.user_id in users else "", "added_at": iso(r.created_at)} for r in rows]


@router.post("/studio/moderators", status_code=201)
def add_mod(data: ModIn, ctx: StudioCtx = Depends(studio("video.comments", "full"))):
    with platform_session() as db:
        u = db.execute(select(User).where(func.lower(User.email) == data.email.strip().lower())).scalars().first()
        if u is None or u.tenant_id == ctx.tenant_id:
            raise err(404, "action_not_allowed")
        if db.execute(select(ChannelModerator.id).where(ChannelModerator.channel_id == ctx.channel.id,
                                                        ChannelModerator.user_id == u.id)).first():
            raise err(409, "action_not_allowed")
        m = ChannelModerator(tenant_id=ctx.tenant_id, channel_id=ctx.channel.id, user_id=u.id, added_by=ctx.user.id)
        db.add(m)
        db.commit()
        return {"id": m.id, "user_id": u.id, "name": u.name, "email": u.email, "added_at": iso(m.created_at)}


@router.delete("/studio/moderators/{mod_id}", status_code=204)
def remove_mod(mod_id: int, ctx: StudioCtx = Depends(studio("video.comments", "full"))):
    m = ctx.db.get(ChannelModerator, mod_id)
    if m is None or m.channel_id != ctx.channel.id:
        raise err(404, "action_not_allowed")
    ctx.db.delete(m)
    ctx.db.commit()
    return Response(status_code=204)


@router.get("/me/moderating")
def moderating(ctx: Ctx = Depends(signed_in)):
    with platform_session() as db:
        rows = db.execute(select(Channel).join(ChannelModerator, ChannelModerator.channel_id == Channel.id)
                          .where(ChannelModerator.user_id == ctx.user.id)).scalars().all()
        return [{"handle": c.handle, "name": c.name} for c in rows]


class ModerateIn(BaseModel):
    status: str


@router.post("/moderation/{kind}/{item_id}")
def moderate(kind: str, item_id: int, data: ModerateIn, ctx: Ctx = Depends(signed_in)):
    if data.status not in ("visible", "hidden") or kind not in ("comments", "danmaku", "posts"):
        raise err(400, "action_not_allowed")
    model = {"comments": Comment, "danmaku": Danmaku, "posts": Post}[kind]
    with platform_session() as db:
        row = db.get(model, item_id)
        if row is None or row.status == "deleted":
            raise err(404, "action_not_allowed")
        channel_id = row.channel_id if kind == "posts" else db.get(Video, row.video_id).channel_id
        if not can_moderate(db, ctx.user, channel_id):
            raise err(403, "action_not_allowed")
        row.status = data.status
        db.commit()
        if kind == "danmaku":
            publish(row.video_id, {"type": "danmaku_removed" if data.status == "hidden" else "danmaku_restored", "id": row.id})
        return {"id": row.id, "status": row.status}


class TranslateIn(BaseModel):
    kind: str
    ids: list[int] = Field(min_length=1, max_length=100)
    lang: str


@router.post("/translate")
def translate(data: TranslateIn, viewer: Viewer = Depends(optional_viewer)):
    if data.lang not in LANGS or data.kind not in ("comments", "danmaku"):
        raise err(400, "action_not_allowed")
    model = Comment if data.kind == "comments" else Danmaku
    with platform_session() as db:
        rows = db.execute(select(model).where(model.id.in_(data.ids), model.status == "visible")).scalars().all()
        source = {r.id: (r.body if data.kind == "comments" else r.text) for r in rows}
        digests = {i: hashlib.sha256(t.encode()).hexdigest() for i, t in source.items()}
        cached = {t.digest: t for t in db.execute(select(TextTranslation).where(
            TextTranslation.digest.in_(set(digests.values()) or {""}), TextTranslation.language == data.lang)).scalars()}
        todo = [i for i, d in digests.items() if d not in cached]
        if todo:
            cues, model_name = intel.translate([Cue(0, 0, source[i]) for i in todo], data.lang, None)
            for i, cue in zip(todo, cues):
                tt = TextTranslation(digest=digests[i], language=data.lang, text=cue.text[:4000], model=model_name)
                db.add(tt)
                cached[digests[i]] = tt
            try:
                db.commit()
            except Exception:
                db.rollback()
        items = [{"id": i, "text": cached[digests[i]].text, "model": cached[digests[i]].model} for i in source]
        return {"lang": data.lang, "machine_translation": all(x["model"] != "sandbox" for x in items), "items": items}


@router.get("/videos/{public_id}/comments/summary")
def comment_summary(public_id: str, lang: str = "en", viewer: Viewer = Depends(optional_viewer)):
    v = readable(viewer, public_id)
    key = f"kv:csum:{v.id}:{lang}"
    try:
        cached = get_redis().get(key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass
    with platform_session() as db:
        rows = db.execute(select(Comment).where(Comment.video_id == v.id, Comment.status == "visible",
                                                Comment.parent_id.is_(None)).order_by(Comment.created_at.desc())
                          .limit(200)).scalars().all()
    if len(rows) < MIN_COMMENTS:
        return {"available": False, "count": len(rows), "needed": MIN_COMMENTS}
    out = _summarise([r.body for r in rows], lang, v.tenant_id)
    out.update(available=True, count=len(rows))
    try:
        get_redis().setex(key, SUMMARY_TTL, json.dumps(out))
    except Exception:
        pass
    return out


def _summarise(texts: list[str], lang: str, tenant_id: int) -> dict:
    from app.ai import llm

    if not llm.is_configured():
        topics = keywords(" ".join(texts), 6)
        quotes, seen = [], set()
        for t in sorted(texts, key=lambda x: -len(content_words(x))):
            words = frozenset(content_words(t))
            if len(words) >= 3 and not any(len(words & s) / len(words) > 0.6 for s in seen):
                seen.add(words)
                quotes.append(t[:200])
            if len(quotes) == 3:
                break
        return {"summary": f"Viewers mostly talk about {', '.join(topics[:4]) or 'this video'}.", "topics": topics,
                "quotes": quotes, "model": "sandbox"}
    system = ("Summarise what viewers say in these comments in 2-3 sentences, neutrally, without quoting personal details. "
              'Reply with JSON {"summary": str, "topics": [str] (<= 6)}. Write in '
              f"{intel.LANG_NAMES.get(lang, 'English')}.")
    data, reply = llm.complete_json("insights", system, "\n".join(f"- {t[:300]}" for t in texts[:150]), tenant_id=tenant_id)
    return {"summary": str(data.get("summary") or "")[:800], "topics": [str(t)[:40] for t in (data.get("topics") or [])][:6],
            "quotes": [], "model": reply.model}

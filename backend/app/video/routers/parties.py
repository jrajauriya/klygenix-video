from __future__ import annotations

import asyncio
import json
import secrets
import time

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from redis import RedisError

from app.core.messages import err
from app.core.redis_client import get_redis
from app.video.models.social import Profile
from app.video.routers import limits
from app.video.routers.deps import Ctx, Viewer, signed_in
from app.video.routers.watch import readable
from app.video.social.filter import clean, has_link

router = APIRouter(prefix="/api/video", tags=["parties"])

TTL = 6 * 3600
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def key(code: str) -> str:
    return f"kv:party:{code}"


def channel(code: str) -> str:
    return f"kv:party-room:{code}"


def load(code: str) -> dict:
    try:
        raw = get_redis().get(key(code.upper()))
    except RedisError:
        raw = None
    if not raw:
        raise err(404, "party_not_found")
    return json.loads(raw)


def save(party: dict) -> None:
    get_redis().setex(key(party["code"]), TTL, json.dumps(party, separators=(",", ":")))


def publish(code: str, event: dict) -> None:
    try:
        get_redis().publish(channel(code), json.dumps(event, separators=(",", ":")))
    except RedisError:
        pass


def position_now(party: dict) -> int:
    pos = party["position_ms"]
    if party["playing"]:
        pos += int((time.time() - party["updated_at"]) * 1000)
    return pos


def public(party: dict) -> dict:
    try:
        members = int(get_redis().scard(f"{key(party['code'])}:members") or 0)
    except RedisError:
        members = 0
    return {"code": party["code"], "video_id": party["video_id"], "host_name": party["host_name"],
            "playing": party["playing"], "position_ms": position_now(party), "server_time": time.time(),
            "members": members, "is_host": False}


class PartyIn(BaseModel):
    video_id: str = Field(min_length=11, max_length=11)


class StateIn(BaseModel):
    playing: bool
    position_ms: int = Field(ge=0)


class ChatIn(BaseModel):
    text: str = Field(min_length=1, max_length=200)


def _name(ctx: Ctx) -> str:
    p = ctx.db.get(Profile, ctx.user.id)
    return (p.display_name if p else ctx.user.name)[:80]


@router.post("/parties", status_code=201)
def create_party(data: PartyIn, request: Request, ctx: Ctx = Depends(signed_in)):
    limits.comment(request, ctx.user.id)
    v = readable(Viewer(db=ctx.db, user=ctx.user), data.video_id)
    if v.status != "published":
        raise err(400, "video_not_ready")
    code = "".join(secrets.choice(ALPHABET) for _ in range(6))
    party = {"code": code, "video_id": v.public_id, "host_id": ctx.user.id, "host_name": _name(ctx),
             "playing": False, "position_ms": 0, "updated_at": time.time()}
    save(party)
    out = public(party)
    out["is_host"] = True
    return out


@router.get("/parties/{code}")
def get_party(code: str, ctx: Ctx = Depends(signed_in)):
    party = load(code)
    out = public(party)
    out["is_host"] = party["host_id"] == ctx.user.id
    return out


@router.post("/parties/{code}/state")
def set_state(code: str, data: StateIn, ctx: Ctx = Depends(signed_in)):
    party = load(code)
    if party["host_id"] != ctx.user.id:
        raise err(403, "party_host_only")
    party.update(playing=data.playing, position_ms=data.position_ms, updated_at=time.time())
    save(party)
    state = public(party)
    publish(party["code"], {"type": "state", **{k: state[k] for k in ("playing", "position_ms", "server_time")}})
    return state


@router.post("/parties/{code}/chat", status_code=201)
def chat(code: str, data: ChatIn, request: Request, ctx: Ctx = Depends(signed_in)):
    party = load(code)
    limits.danmaku(request, ctx.user.id)
    ok, text = clean(data.text)
    if not text:
        raise err(400, "comment_empty")
    if not ok or has_link(text):
        raise err(400, "danmaku_blocked_words")
    event = {"type": "chat", "name": _name(ctx), "text": text, "at": time.time(), "position_ms": position_now(party)}
    publish(party["code"], event)
    return event


@router.delete("/parties/{code}", status_code=204)
def end_party(code: str, ctx: Ctx = Depends(signed_in)):
    from fastapi import Response

    party = load(code)
    if party["host_id"] != ctx.user.id:
        raise err(403, "party_host_only")
    get_redis().delete(key(party["code"]), f"{key(party['code'])}:members")
    publish(party["code"], {"type": "ended"})
    return Response(status_code=204)


@router.websocket("/ws/parties/{code}")
async def party_room(websocket: WebSocket, code: str):
    from app.video.realtime.hub import hub, relay

    try:
        party = await asyncio.to_thread(load, code)
    except Exception:
        await websocket.close(code=4404)
        return
    await websocket.accept()
    client = await hub.client()
    q = await hub.subscribe(channel(party["code"]))
    members = f"{key(party['code'])}:members"
    me = secrets.token_hex(8)
    await client.sadd(members, me)
    await client.expire(members, TTL)
    await client.publish(channel(party["code"]), json.dumps({"type": "members", "members": int(await client.scard(members))}))

    task = asyncio.create_task(relay(websocket, q))
    try:
        await websocket.send_text(json.dumps({"type": "hello", **public(party)}))
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text(json.dumps({"type": "pong", "server_time": time.time()}))
    except WebSocketDisconnect:
        pass
    finally:
        task.cancel()
        await client.srem(members, me)
        try:
            await client.publish(channel(party["code"]), json.dumps({"type": "members", "members": int(await client.scard(members))}))
        except Exception:
            pass
        await hub.unsubscribe(channel(party["code"]), q)

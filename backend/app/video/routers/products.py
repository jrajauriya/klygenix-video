from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from app.core.messages import err
from app.video.models.media import ProductLink, Video
from app.video.routers.deps import StudioCtx, studio
from app.video.sessions import platform_session

router = APIRouter(prefix="/api/video", tags=["products"])
MAX_LINKS = 5
DISCLOSURE = "Product link added by the creator. Klygenix Play does not sell this product."


def link_out(p: ProductLink, with_url: bool = True) -> dict:
    out = {"id": p.id, "title": p.title, "price_text": p.price_text, "position": p.position, "clicks": p.clicks,
           "host": p.url.split("//", 1)[-1].split("/", 1)[0].removeprefix("www.")}
    if with_url:
        out["url"] = p.url
    return out


def public_links(db, video_id: int) -> dict | None:
    rows = db.execute(select(ProductLink).where(ProductLink.video_id == video_id).order_by(ProductLink.position,
                                                                                         ProductLink.id)).scalars().all()
    if not rows:
        return None
    return {"disclosure": DISCLOSURE, "items": [{k: v for k, v in link_out(p, False).items() if k != "clicks"} for p in rows]}


class LinkIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=10, max_length=500)
    price_text: str = Field(default="", max_length=40)
    position: int = Field(default=0, ge=0, le=20)


def _own(ctx: StudioCtx, video_id: int) -> Video:
    v = ctx.db.get(Video, video_id)
    if v is None or v.tenant_id != ctx.tenant_id or v.is_deleted:
        raise err(404, "video_not_found")
    return v


@router.get("/studio/videos/{video_id}/products")
def list_links(video_id: int, ctx: StudioCtx = Depends(studio("video.uploads"))):
    v = _own(ctx, video_id)
    return [link_out(p) for p in ctx.db.execute(select(ProductLink).where(ProductLink.video_id == v.id)
                                                .order_by(ProductLink.position, ProductLink.id)).scalars()]


@router.post("/studio/videos/{video_id}/products", status_code=201)
def add_link(video_id: int, data: LinkIn, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = _own(ctx, video_id)
    if not data.url.startswith("https://") or " " in data.url:
        raise err(400, "action_not_allowed")
    if len(ctx.db.execute(select(ProductLink.id).where(ProductLink.video_id == v.id)).all()) >= MAX_LINKS:
        raise err(409, "action_not_allowed")
    p = ProductLink(tenant_id=ctx.tenant_id, video_id=v.id, title=data.title.strip(), url=data.url.strip(),
                    price_text=data.price_text.strip(), position=data.position)
    ctx.db.add(p)
    ctx.db.commit()
    return link_out(p)


@router.delete("/studio/videos/{video_id}/products/{link_id}", status_code=204)
def delete_link(video_id: int, link_id: int, ctx: StudioCtx = Depends(studio("video.uploads", "full"))):
    v = _own(ctx, video_id)
    p = ctx.db.get(ProductLink, link_id)
    if p is None or p.video_id != v.id:
        raise err(404, "action_not_allowed")
    ctx.db.delete(p)
    ctx.db.commit()
    return Response(status_code=204)


@router.post("/products/{link_id}/click")
def click(link_id: int):
    with platform_session() as db:
        p = db.get(ProductLink, link_id)
        v = db.get(Video, p.video_id) if p else None
        if p is None or v is None or v.status != "published" or v.is_deleted:
            raise err(404, "action_not_allowed")
        db.execute(update(ProductLink).where(ProductLink.id == p.id).values(clicks=ProductLink.clicks + 1))
        db.commit()
        return {"url": p.url}

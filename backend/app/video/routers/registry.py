from app.video.routers import (
    admin_video, ai, billing, channels, me, parties, playlists, sandbox, social, studio_clips, studio_insights, studio_videos, trust, watch,
    webhooks,
)

ROUTERS: list = [
    watch.router,
    social.router,
    ai.router,
    billing.router,
    trust.router,
    channels.router,
    studio_videos.router,
    studio_insights.router,
    me.router,
    playlists.router,
    parties.router,
    studio_clips.router,
    admin_video.router,
    sandbox.router,
    webhooks.router,
]

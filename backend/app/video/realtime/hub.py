from __future__ import annotations

import asyncio
import logging

from fastapi import WebSocket

from app.config import settings

logger = logging.getLogger(__name__)
QUEUE = 500


class Hub:
    def __init__(self) -> None:
        self.redis = None
        self.pubsub = None
        self.subs: dict[str, set[asyncio.Queue]] = {}
        self.task: asyncio.Task | None = None
        self.lock = asyncio.Lock()

    async def client(self):
        if self.redis is None:
            from redis.asyncio import BlockingConnectionPool, Redis

            self.redis = Redis(connection_pool=BlockingConnectionPool.from_url(settings.REDIS_URL, max_connections=128,
                                                                               timeout=20))
        return self.redis

    async def subscribe(self, channel: str) -> asyncio.Queue:
        async with self.lock:
            r = await self.client()
            if self.pubsub is None:
                self.pubsub = r.pubsub()
            q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE)
            if channel not in self.subs:
                self.subs[channel] = set()
                await self.pubsub.subscribe(channel)
            self.subs[channel].add(q)
            if self.task is None or self.task.done():
                self.task = asyncio.create_task(self._pump())
            return q

    async def unsubscribe(self, channel: str, q: asyncio.Queue) -> None:
        async with self.lock:
            group = self.subs.get(channel)
            if group is None:
                return
            group.discard(q)
            if not group:
                del self.subs[channel]
                try:
                    await self.pubsub.unsubscribe(channel)
                except Exception:
                    pass

    async def _pump(self) -> None:
        while True:
            try:
                if not self.subs:
                    await asyncio.sleep(0.2)
                    continue
                msg = await self.pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("realtime hub read failed")
                await asyncio.sleep(0.5)
                continue
            if not msg or msg.get("type") != "message":
                continue
            channel = msg["channel"].decode() if isinstance(msg["channel"], bytes) else msg["channel"]
            data = msg["data"].decode() if isinstance(msg["data"], bytes) else msg["data"]
            dropped = 0
            for q in list(self.subs.get(channel, ())):
                try:
                    q.put_nowait(data)
                except asyncio.QueueFull:
                    dropped += 1
            if dropped:
                asyncio.create_task(self._count_dropped(dropped))

    async def _count_dropped(self, n: int) -> None:
        from app.core.services.metrics import REALTIME_KEY

        try:
            await self.redis.hincrby(REALTIME_KEY, "dropped", n)
        except Exception:
            pass


hub = Hub()


async def relay(websocket: WebSocket, q: asyncio.Queue) -> None:
    while True:
        data = await q.get()
        await websocket.send_text(data)

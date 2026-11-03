from __future__ import annotations

import glob
import logging
import os
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field
from datetime import timedelta

from sqlalchemy import select

from app.config import settings
from app.video.live import service
from app.video.live.gate import Gate
from app.video.media.ffmpeg import FFMPEG
from app.video.models.media import LiveStream
from app.video.sessions import platform_session

logger = logging.getLogger(__name__)
INNER_OFFSET = 1000


def outputs(directory: str, session: str) -> list[str]:
    hls = (f"[f=hls:hls_time=1:hls_list_size=8:start_number={_next_segment(directory)}"
           f":hls_flags=delete_segments+independent_segments+append_list+discont_start+omit_endlist"
           f":hls_segment_filename={directory}/seg_{session}_%05d.ts]{directory}/index.m3u8")
    return ["-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
            "-pix_fmt", "yuv420p", "-r", "30", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-c:a", "aac",
            "-b:a", "96k", "-ar", "44100", "-f", "tee", f"{hls}|[f=mpegts]{directory}/record_{session}.ts"]


def _next_segment(directory: str) -> int:
    return len(glob.glob(os.path.join(directory, "seg_*.ts")))


@dataclass
class Listener:
    stream_id: int
    port: int
    key: str
    proc: subprocess.Popen | None = None
    sessions: list[str] = field(default_factory=list)

    @property
    def inner_port(self) -> int:
        return self.port + INNER_OFFSET

    def start(self) -> None:
        directory = service.live_dir(self.stream_id)
        session = str(int(time.time() * 1000))
        self.sessions.append(session)
        args = [FFMPEG, "-nostdin", "-loglevel", "error", "-listen", "1",
                "-i", f"rtmp://127.0.0.1:{self.inner_port}/live/{self.key}", *outputs(directory, session)]
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with open(os.path.join(directory, ".pid"), "w") as fh:
            fh.write(str(self.proc.pid))

    def alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def stop(self) -> None:
        if self.alive():
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def reap_orphans() -> None:
    import signal

    from app.video.media.paths import media_root

    for pidfile in glob.glob(os.path.join(media_root(), "live", "*", ".pid")):
        try:
            pid = int(open(pidfile).read().strip() or 0)
            if pid:
                os.kill(pid, signal.SIGTERM)
        except (ValueError, ProcessLookupError, PermissionError, OSError):
            pass
        try:
            os.remove(pidfile)
        except OSError:
            pass


class Supervisor:
    def __init__(self) -> None:
        self.listeners: dict[int, Listener] = {}
        self.gates: list[Gate] = []
        reap_orphans()
        for port in service.ports():
            gate = Gate(port, port + INNER_OFFSET, lambda p=port: self.key_for(p))
            try:
                gate.start()
                self.gates.append(gate)
            except OSError:
                logger.warning("live port %s is busy", port)

    def key_for(self, port: int) -> str | None:
        for ln in list(self.listeners.values()):
            if ln.port == port:
                return ln.key
        return None

    def tick(self) -> None:
        with platform_session() as db:
            streams = db.execute(select(LiveStream).where(LiveStream.provider == "sandbox",
                                                          LiveStream.status.in_(service.ACTIVE))).scalars().all()
            active = {s.id for s in streams}
            events: list[tuple[LiveStream, dict]] = []
            for sid in list(self.listeners):
                if sid not in active:
                    self.listeners.pop(sid).stop()
                    finalize(sid)
            for s in streams:
                ln = self.listeners.get(s.id)
                key = service.key_of(s)
                if ln is not None and ln.key != key:
                    ln.stop()
                    ln = None
                if ln is None or not ln.alive():
                    if ln is None:
                        ln = Listener(s.id, s.ingest_port, key)
                        self.listeners[s.id] = ln
                    ln.start()
                fresh = latest_segment_age(s.id)
                if fresh is not None and fresh < 10:
                    if s.status != "live":
                        s.status, s.started_at = "live", service.now()
                        from app.video.after_commit import later
                        from app.video.services.push import notify_followers_live

                        later(db, notify_followers_live, s.id)
                        events.append((s, {"type": "live"}))
                    s.last_seen_at = service.now()
                elif s.status == "live" and s.last_seen_at and \
                        service.now() - s.last_seen_at > timedelta(seconds=settings.LIVE_IDLE_END_SECONDS):
                    service.end(db, s)
                    events.append((s, {"type": "ended", "reason": "idle"}))
            db.commit()
            if events:
                from app.video.routers.live import emit

                for s, event in events:
                    emit(s, event)
            for s in db.execute(select(LiveStream).where(LiveStream.provider == "sandbox", LiveStream.status.in_(("ended", "failed")),
                                                         LiveStream.ended_at.is_not(None), LiveStream.error.is_(None),
                                                         LiveStream.replay_video_id.is_(None))).scalars().all():
                if s.id not in self.listeners and not os.path.exists(os.path.join(service.live_dir(s.id), ".final")):
                    finalize(s.id)

    def stop(self) -> None:
        for gate in self.gates:
            gate.stop()
        for ln in self.listeners.values():
            ln.stop()


def latest_segment_age(stream_id: int) -> float | None:
    segs = glob.glob(os.path.join(service.live_dir(stream_id), "seg_*.ts"))
    if not segs:
        return None
    return time.time() - max(os.path.getmtime(p) for p in segs)


def finalize(stream_id: int) -> None:
    from app.video.media import service as media
    from app.video.media.providers import provider
    from app.video.models.social import Channel

    directory = service.live_dir(stream_id)
    marker = os.path.join(directory, ".final")
    if os.path.exists(marker):
        return
    with open(marker, "w") as fh:
        fh.write("1")
    playlist = os.path.join(directory, "index.m3u8")
    if os.path.exists(playlist):
        with open(playlist, "a") as fh:
            fh.write("#EXT-X-ENDLIST\n")
    parts = sorted(p for p in glob.glob(os.path.join(directory, "record_*.ts")) if os.path.getsize(p) > 0)
    with platform_session() as db:
        s = db.get(LiveStream, stream_id)
        if s is None or not s.replay_enabled or not parts or not s.started_at or s.error:
            return
        listing = os.path.join(directory, "replay.txt")
        with open(listing, "w") as fh:
            fh.writelines(f"file '{p}'\n" for p in parts)
        mp4 = os.path.join(directory, "replay.mp4")
        try:
            subprocess.run([FFMPEG, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listing, "-c", "copy",
                            "-movflags", "+faststart", mp4], check=True, capture_output=True, timeout=1800)
            channel = db.get(Channel, s.channel_id)
            from app.video.commerce import quotas

            owner = quotas.owner_user_id(db, s.tenant_id)
            video = media.create_video(db, channel=channel, user_id=owner or 0, title=f"{s.title} (live replay)",
                                       description=s.description, visibility="public", rights_declared=True)
            if s.members_rank:
                video.access, video.members_rank = "members", s.members_rank
            db.flush()
            prov = provider(video.provider)
            video.provider_video_id = prov.ingest_file(video, mp4)
            video.status = "processing"
            s.replay_video_id = video.id
            db.commit()
            if prov.name == "sandbox":
                from app.video.pipeline.jobs import sandbox_encode

                sandbox_encode.enqueue(video.id)
        except Exception as exc:
            db.rollback()
            s = db.get(LiveStream, stream_id)
            s.error = f"replay: {type(exc).__name__}: {exc}"[:500]
            db.commit()


_thread: threading.Thread | None = None
_stop = threading.Event()


def run_forever(stop: threading.Event | None = None) -> None:
    sup = None
    stop = stop or threading.Event()
    try:
        sup = Supervisor()
        while not stop.is_set():
            try:
                sup.tick()
            except Exception:
                logger.exception("live supervisor tick failed")
            stop.wait(0.5)
    finally:
        if sup is not None:
            sup.stop()


def start_inline() -> None:
    global _thread
    if _thread is not None or not shutil.which(FFMPEG):
        return
    _stop.clear()
    _thread = threading.Thread(target=run_forever, args=(_stop,), name="live-supervisor", daemon=True)
    _thread.start()


def stop_inline() -> None:
    global _thread
    _stop.set()
    if _thread is not None:
        _thread.join(8)
        _thread = None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_forever()

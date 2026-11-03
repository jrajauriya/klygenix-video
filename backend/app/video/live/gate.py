from __future__ import annotations

import hmac
import socket
import struct
import threading

MARKER = b"\x02\x00\x07publish"
LIMIT = 256 * 1024


def stream_name(buf: bytes) -> str | None:
    i = buf.find(MARKER)
    if i < 0:
        return None
    j = i + len(MARKER)
    if len(buf) < j + 9 or buf[j] != 0x00:
        return None
    j += 9
    if len(buf) > j and buf[j] == 0x05:
        j += 1
    if len(buf) < j + 3 or buf[j] != 0x02:
        return None
    n = struct.unpack(">H", buf[j + 1:j + 3])[0]
    if len(buf) < j + 3 + n:
        return None
    return buf[j + 3:j + 3 + n].decode("utf-8", "replace").split("?")[0]


def _held(buf: bytes) -> int:
    i = buf.find(MARKER)
    if i >= 0:
        return i
    for k in range(min(len(MARKER) - 1, len(buf)), 0, -1):
        if buf.endswith(MARKER[:k]):
            return len(buf) - k
    return len(buf)


def _pipe(src: socket.socket, dst: socket.socket) -> None:
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def _connect(upstream: tuple[str, int], tries: int = 20) -> socket.socket | None:
    import time

    for _ in range(tries):
        try:
            up = socket.create_connection(upstream, timeout=5)
            up.settimeout(None)
            return up
        except OSError:
            time.sleep(0.25)
    return None


def _client(conn: socket.socket, upstream: tuple[str, int], resolve) -> None:
    import time

    key = resolve()
    for _ in range(12):
        if key:
            break
        time.sleep(0.25)
        key = resolve()
    up = _connect(upstream) if key else None
    if up is None:
        conn.close()
        return
    threading.Thread(target=_pipe, args=(up, conn), daemon=True).start()
    pending = bytearray()
    try:
        conn.settimeout(20)
        while True:
            data = conn.recv(65536)
            if not data:
                raise ConnectionError
            pending += data
            name = stream_name(bytes(pending))
            if name is not None:
                key = resolve() or ""
                if not key or not hmac.compare_digest(name, key):
                    raise PermissionError
                up.sendall(pending)
                break
            if len(pending) > LIMIT:
                raise PermissionError
            hold = _held(bytes(pending))
            if hold:
                up.sendall(pending[:hold])
                del pending[:hold]
        conn.settimeout(None)
        _pipe(conn, up)
    except (OSError, ConnectionError, PermissionError):
        for s in (conn, up):
            try:
                s.close()
            except OSError:
                pass


class Gate:
    def __init__(self, port: int, upstream_port: int, resolve) -> None:
        self.port, self.upstream, self.resolve = port, ("127.0.0.1", upstream_port), resolve
        self.sock: socket.socket | None = None
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        from app.config import settings

        self.sock.bind((settings.LIVE_GATE_BIND, self.port))
        self.sock.listen(8)
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _serve(self) -> None:
        while self.sock is not None:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=_client, args=(conn, self.upstream, self.resolve), daemon=True).start()

    def stop(self) -> None:
        s, self.sock = self.sock, None
        if s is not None:
            try:
                s.close()
            except OSError:
                pass

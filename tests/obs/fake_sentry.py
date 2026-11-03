from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import threading
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROUTE = re.compile(r"^/api/(\d+)/(envelope|store)/?(\?.*)?$")


def parse_envelope(raw: bytes) -> dict:
    pos = 0

    def line() -> bytes:
        nonlocal pos
        end = raw.find(b"\n", pos)
        if end < 0:
            end = len(raw)
        out = raw[pos:end]
        pos = end + 1
        return out

    header = json.loads(line() or b"{}")
    items = []
    while pos < len(raw):
        head_line = line()
        if not head_line.strip():
            continue
        item_header = json.loads(head_line)
        length = item_header.get("length")
        if length is not None:
            body = raw[pos:pos + length]
            pos += length + 1
        else:
            body = line()
        try:
            payload = json.loads(body)
        except ValueError:
            payload = body.decode("utf-8", "replace")
        items.append({"header": item_header, "payload": payload})
    return {"header": header, "items": items}


class Sink:
    def __init__(self, out: Path) -> None:
        self.out = out
        self.lock = threading.Lock()
        self.records: list[dict] = []
        out.write_text("[]")

    def add(self, record: dict) -> None:
        with self.lock:
            self.records.append(record)
            tmp = self.out.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.records, indent=1, default=str))
            os.replace(tmp, self.out)


def handler_for(sink: Sink):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args) -> None:
            pass

        def _cors(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self) -> None:
            body = json.dumps(sink.records, default=str).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self) -> None:
            m = ROUTE.match(self.path)
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            if not m:
                self.send_response(404)
                self.end_headers()
                return
            encoding = (self.headers.get("Content-Encoding") or "").lower()
            if encoding == "gzip":
                raw = gzip.decompress(raw)
            elif encoding == "deflate":
                raw = zlib.decompress(raw)
            elif encoding == "br":
                import brotli

                raw = brotli.decompress(raw)
            if m.group(2) == "envelope":
                parsed = parse_envelope(raw)
            else:
                parsed = {"header": {}, "items": [{"header": {"type": "event"}, "payload": json.loads(raw)}]}
            sink.add({"project": m.group(1), "path": self.path.split("?")[0],
                      "request_headers": dict(self.headers.items()), **parsed})
            body = json.dumps({"id": (parsed["header"] or {}).get("event_id", "")}).encode()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


def serve(port: int, out: Path) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", port), handler_for(Sink(out)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main() -> None:
    ap = argparse.ArgumentParser(description="A local Sentry-protocol ingest that writes envelopes to a JSON file.")
    ap.add_argument("--port", type=int, default=9199)
    ap.add_argument("--out", default="fake-sentry-events.json")
    args = ap.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(Sink(Path(args.out))))
    print(f"fake sentry on http://127.0.0.1:{args.port} -> {args.out}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

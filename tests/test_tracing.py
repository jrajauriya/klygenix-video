"""Run 6 tracing: request, job and LLM spans with W3C trace context; OTLP/JSON export only when an endpoint is set."""

from __future__ import annotations

import json
import time

import httpx
from fastapi.testclient import TestClient

from fakehttp import calls, configured, fake
from harness import check, finish, ok

from app.core.services import tracing
from app.main import app

tc = TestClient(app, client=("127.0.0.1", 50000))

print("\n== off by default")
tracing.clear()
r = tc.get("/api/video/feed/home?limit=1")
check("no spans and no header without an endpoint", (tracing.finished(), "traceparent" in r.headers), ([], False))

print("\n== request spans")
with configured(TRACING="memory"):
    tracing.clear()
    r = tc.get("/api/video/feed/home?limit=1")
    spans = tracing.finished()
    server = [s for s in spans if s["kind"] == 2]
    ok("one server span per request", len(server) == 1, spans)
    attrs = {a["key"]: list(a["value"].values())[0] for a in server[0]["attributes"]}
    check("method, route and status recorded", (attrs.get("http.request.method"), attrs.get("http.route"),
                                               attrs.get("http.response.status_code")), ("GET", "/api/video/feed/home", "200"))
    tid = server[0]["traceId"]
    check("the response carries its traceparent", r.headers.get("traceparent", "").split("-")[1], tid)
    tracing.clear()
    incoming = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    tc.get("/api/video/feed/home?limit=1", headers={"traceparent": incoming})
    s = [x for x in tracing.finished() if x["kind"] == 2][0]
    check("an incoming trace is continued", (s["traceId"], s.get("parentSpanId")), ("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7"))
    tracing.clear()
    tc.get("/api/video/feed/home?limit=1", headers={"traceparent": "garbage"})
    s = [x for x in tracing.finished() if x["kind"] == 2][0]
    check("a malformed header starts a new trace", "parentSpanId" in s, False)

    print("\n== job spans follow the request")
    from app.video.jobs import job

    @job
    def traced_probe(n: int) -> int:
        return n * 2

    tracing.clear()
    with tracing.span("enqueuing request", "server") as _:
        parent = tracing.traceparent()
        traced_probe.enqueue(21)
    deadline = time.time() + 10
    while time.time() < deadline and not any(x["name"] == "job traced_probe" for x in tracing.finished()):
        time.sleep(0.1)
    js = [x for x in tracing.finished() if x["name"] == "job traced_probe"]
    ok("the job ran in a span", len(js) == 1, tracing.finished())
    check("in the same trace as the request that queued it", (js[0]["traceId"], js[0]["parentSpanId"]), tuple(parent.split("-")[1:3]))

    print("\n== LLM calls are client spans")
    from app.ai import llm

    def model(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "completed", "model": "gpt-test", "output": [
            {"type": "message", "content": [{"type": "output_text", "text": "hello"}]}],
            "usage": {"input_tokens": 3, "output_tokens": 1}})

    tracing.clear()
    with configured(LLM_BASE_URL="https://llm.example/openai/v1/responses", LLM_API_KEY="k"), fake(model):
        try:
            llm._call([{"role": "user", "content": "hi"}], model="gpt-test", max_tokens=5)
        except Exception as exc:
            print("  llm call:", exc)
    cs = [x for x in tracing.finished() if x["kind"] == 3]
    check("an LLM span with the model", [(x["name"], {a["key"]: list(a["value"].values())[0] for a in x["attributes"]}.get(
        "gen_ai.request.model")) for x in cs], [("llm responses", "gpt-test")])

print("\n== OTLP export")
with configured(OTEL_EXPORTER_OTLP_ENDPOINT="https://otel.example:4318", OTEL_EXPORTER_OTLP_HEADERS="x-team=play"):
    exporter = tracing.Exporter("https://otel.example:4318", every=3600)
    tracing._exporter = exporter
    with fake(lambda req: httpx.Response(200, json={})):
        tc.get("/api/video/feed/home?limit=1")
        sent = exporter.flush()
        posted = [c for c in calls if c.url.path == "/v1/traces"]
    ok("spans are exported in batches", sent >= 1 and len(posted) == 1, (sent, [str(c.url) for c in calls]))
    body = json.loads(posted[0].content)
    res = {a["key"]: list(a["value"].values())[0] for a in body["resourceSpans"][0]["resource"]["attributes"]}
    check("as OTLP JSON with the service name", (res["service.name"], "spans" in body["resourceSpans"][0]["scopeSpans"][0]), ("klygenix-play", True))
    check("with the configured headers", posted[0].headers.get("x-team"), "play")
    with fake(lambda req: httpx.Response(503)):
        with tracing.span("lost"):
            pass
        ok("an unreachable collector never breaks the app", exporter.flush() >= 0)
    tracing._exporter = None

finish()

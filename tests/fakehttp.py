from __future__ import annotations

import contextlib

import httpx

import harness  # noqa: F401
from app.config import settings

calls: list[httpx.Request] = []
real = {n: getattr(httpx, n) for n in ("request", "get", "post", "put", "patch", "delete", "stream")}


@contextlib.contextmanager
def fake(handler):
    calls.clear()
    transport = httpx.MockTransport(lambda req: (calls.append(req), handler(req))[1])

    def request(method, url, **kw):
        kw.pop("timeout", None)
        auth = kw.pop("auth", None)
        follow = kw.pop("follow_redirects", False)
        with httpx.Client(transport=transport, auth=auth, follow_redirects=follow) as c:
            return c.request(method, url, **kw)

    @contextlib.contextmanager
    def stream(method, url, **kw):
        kw.pop("timeout", None)
        kw.pop("follow_redirects", None)
        with httpx.Client(transport=transport) as c:
            with c.stream(method, url, **kw) as r:
                yield r

    httpx.request = request
    for verb in ("get", "post", "put", "patch", "delete"):
        setattr(httpx, verb, lambda url, _v=verb, **kw: request(_v.upper(), url, **kw))
    httpx.stream = stream
    try:
        yield calls
    finally:
        for n, f in real.items():
            setattr(httpx, n, f)


@contextlib.contextmanager
def configured(**values):
    saved = {k: getattr(settings, k) for k in values}
    for k, v in values.items():
        setattr(settings, k, v)
    try:
        yield
    finally:
        for k, v in saved.items():
            setattr(settings, k, v)

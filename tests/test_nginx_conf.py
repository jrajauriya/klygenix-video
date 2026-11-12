"""nginx template rules found under load: upstream keepalive for HTTP, none for WebSocket upgrades."""

from __future__ import annotations

import pathlib
import re

CONF = (pathlib.Path(__file__).resolve().parent.parent / "infra" / "nginx" / "prod.conf.template").read_text()
PASS = FAIL = 0


def check(name, actual, expected):
    global PASS, FAIL
    if actual == expected:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name}: got {actual!r}, expected {expected!r}")


def blocks(kind: str) -> list[str]:
    out, i = [], 0
    while (m := re.compile(rf"^\s*{kind}\b[^{{;]*{{", re.M).search(CONF, i)):
        depth, j = 1, m.end()
        while depth:
            depth += {"{": 1, "}": -1}.get(CONF[j], 0)
            j += 1
        out.append(CONF[m.start():j])
        i = j
    return out


def upstream(name: str) -> str:
    return next((b for b in blocks("upstream") if re.match(rf"\s*upstream\s+{name}\b", b)), "")


def location(server: str, path: str) -> str:
    m = re.search(rf"location\s+{re.escape(path)}\s*{{(.*?)\n\s*}}", server, re.S)
    return m.group(1) if m else ""


print("\n== upstreams")
check("HTTP keeps upstream connections alive", "keepalive 64;" in upstream("kv_api"), True)
check("the WebSocket upstream has no keepalive pool", ("server backend:9300" in upstream("kv_ws"), "keepalive" in upstream("kv_ws")),
      (True, False))
check("the WebSocket map points at it", bool(re.search(r"map \$host \$kv_ws_backend \{ default kv_ws; \}", CONF)), True)

print("\n== every host that proxies the API sends upgrades to the WebSocket upstream")
api_servers = [s for s in blocks("server") if re.search(r"location\s+/(api/)?\s*\{[^}]*proxy_pass http://\$kv_backend", s, re.S)]
check("hosts proxying the API", len(api_servers), 2)
for s in api_servers:
    host = re.search(r"server_name\s+([^;]+);", s).group(1).strip()
    ws = location(s, "/api/video/ws/")
    check(f"{host}: /api/video/ws/ uses $kv_ws_backend", "proxy_pass http://$kv_ws_backend;" in ws, True)
    check(f"{host}: and stays open an hour", ("proxy_read_timeout 3600s;" in ws, "proxy_send_timeout 3600s;" in ws), (True, True))
    check(f"{host}: with the upgrade headers", "include /etc/nginx/snippets/proxy-backend.conf;" in ws, True)
check("no other location sends upgrades to the pooled upstream",
      [m for m in re.findall(r"location\s+(\S+)\s*\{", CONF) if "ws" in m.split("/")], ["/api/video/ws/", "/api/video/ws/"])

print("\n== host names: one helper, nested for the local stack, flat for production")
import subprocess  # noqa: E402

NGINX = pathlib.Path(__file__).resolve().parent.parent / "infra" / "nginx"


def hosts(style: str) -> list[str]:
    out = subprocess.run(["sh", "-c", f'. "{NGINX / "hosts.sh"}"; echo $STUDIO_HOST $ADMIN_HOST $API_HOST $TV_HOST'],
                         env={"PUBLIC_DOMAIN": "play.klygenix.com", "HOST_STYLE": style, "PATH": "/usr/bin:/bin"},
                         capture_output=True, text=True, check=True).stdout.split()
    return out


check("flat", hosts("flat"), ["play-studio.klygenix.com", "play-admin.klygenix.com", "play-api.klygenix.com", "play-tv.klygenix.com"])
check("nested", hosts("nested"), ["studio.play.klygenix.com", "admin.play.klygenix.com", "api.play.klygenix.com", "tv.play.klygenix.com"])
templates = [CONF] + [p.read_text() for p in (NGINX / "snippets").glob("*.conf")]
check("no template builds a nested host by hand",
      [m for t in templates for m in re.findall(r"(?:studio|admin|api|tv)\.\$\{PUBLIC_DOMAIN\}", t)], [])
render = (NGINX / "render.sh").read_text()
check("render.sh loads the helper and substitutes every host",
      (". /etc/nginx/hosts.sh" in render, all(f"${{{v}}}" in render for v in ("STUDIO_HOST", "ADMIN_HOST", "API_HOST", "TV_HOST"))),
      (True, True))
deploy = (NGINX.parent / "deploy.sh").read_text()
compose = (NGINX.parent / "docker-compose.prod.yml").read_text()
mounted = sorted(set(re.findall(r"\./nginx/([a-z]+\.sh):", compose)))
check("every script nginx mounts is uploaded by deploy.sh",
      [s for s in mounted if deploy.count(f"infra/nginx/{s}") < 2], [])

print(f"\n{PASS} passed, {FAIL} failed")
raise SystemExit(1 if FAIL else 0)

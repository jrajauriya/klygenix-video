#!/bin/bash
# Usage: bash infra/monitoring.sh check | up | status | down   (up/status/down attach to the local stack)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA="$ROOT/infra"
CFG="$INFRA/prometheus"
OUT="$INFRA/build/monitoring"
ENV_FILE="$INFRA/.env.staging"
STACK_PROJECT="klygenix-video-staging"
PROMETHEUS_IMAGE="prom/prometheus:v3.15.0"
ALERTMANAGER_IMAGE="prom/alertmanager:v0.34.1"
BLACKBOX_IMAGE="prom/blackbox-exporter:v0.28.0"
export KV_PROMETHEUS_PORT="${KV_PROMETHEUS_PORT:-9190}"
export KV_ALERTMANAGER_PORT="${KV_ALERTMANAGER_PORT:-9193}"

value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- ; }
say() { printf '\n== %s\n' "$*"; }

compose() {
  docker compose -p klygenix-video-monitoring --project-directory "$INFRA" \
    -f "$INFRA/docker-compose.monitoring.yml" -f "$INFRA/docker-compose.monitoring.local.yml" "$@"
}

check() {
  local dir="${1:-$CFG}" token
  token="$(mktemp)"; echo "check-token" > "$token"
  say "promtool check rules"
  docker run --rm -v "$dir:/cfg:ro" --entrypoint /bin/promtool "$PROMETHEUS_IMAGE" check rules /cfg/alerts.yml
  say "promtool test rules"
  docker run --rm -v "$CFG:/cfg:ro" -w /cfg --entrypoint /bin/promtool "$PROMETHEUS_IMAGE" test rules alerts.test.yml
  say "promtool check config"
  docker run --rm -v "$dir/prometheus.yml:/etc/prometheus/prometheus.yml:ro" -v "$dir/alerts.yml:/etc/prometheus/alerts.yml:ro" \
    -v "$token:/etc/prometheus/metrics-token:ro" --entrypoint /bin/promtool "$PROMETHEUS_IMAGE" check config /etc/prometheus/prometheus.yml
  say "amtool check-config"
  docker run --rm -v "$dir/alertmanager.yml:/cfg/alertmanager.yml:ro" --entrypoint /bin/amtool "$ALERTMANAGER_IMAGE" check-config /cfg/alertmanager.yml
  say "blackbox --config.check"
  docker run --rm -v "$dir/blackbox.yml:/cfg/blackbox.yml:ro" "$BLACKBOX_IMAGE" --config.file=/cfg/blackbox.yml --config.check
  rm -f "$token"
}

render_local() {
  [[ -f "$ENV_FILE" ]] || { echo "no $ENV_FILE — run: bash infra/local-stack.sh up"; exit 1; }
  local domain product
  domain="$(value STAGING_DOMAIN)"; domain="${domain:-store.localhost}"
  mkdir -p "$OUT/textfile"
  product="$(docker exec "$STACK_PROJECT-postgres" psql -U "$(value POSTGRES_USER)" -d "$(value POSTGRES_DB)" -Atc \
    "SELECT '@' || s.handle || '/p/' || p.slug FROM kv_catalog.products p JOIN kv_catalog.stores s ON s.tenant_id = p.tenant_id
      WHERE p.status = 'published' ORDER BY p.id LIMIT 1" 2>/dev/null || true)"
  sed -e "s#store\.klygenix\.com#$domain#g" -e "s#/p/PRODUCT_SLUG#/${product:-p/PRODUCT_SLUG}#" "$CFG/prometheus.yml" > "$OUT/prometheus.yml"
  sed -e "s#insecure_skip_verify: false#insecure_skip_verify: true#" "$CFG/blackbox.yml" > "$OUT/blackbox.yml"
  cp "$CFG/alerts.yml" "$CFG/alertmanager.yml" "$OUT/"
  printf '%s' "$(value METRICS_TOKEN)" > "$OUT/metrics-token"
  chmod 644 "$OUT/metrics-token"
  echo "  rendered $OUT (domain $domain, product ${product:-none})"
}

up() {
  docker inspect "$STACK_PROJECT-nginx" >/dev/null 2>&1 || { echo "the local stack is not running — bash infra/local-stack.sh up"; exit 1; }
  render_local
  check "$OUT"
  export KV_MONITORING_CONFIG="$OUT" KV_METRICS_TOKEN_FILE="$OUT/metrics-token" KV_TEXTFILE_DIR="$OUT/textfile"
  export KV_STACK_NETWORK="${STACK_PROJECT}_default"
  KV_PROBE_IP="$(docker inspect -f "{{(index .NetworkSettings.Networks \"$KV_STACK_NETWORK\").IPAddress}}" "$STACK_PROJECT-nginx")"
  export KV_PROBE_IP
  say "Writing textfile metrics from the local stack"
  PG_CONTAINER="$STACK_PROJECT-postgres" KV_TEXTFILE_DIR="$OUT/textfile" bash "$INFRA/archive-metrics.sh"
  PG_CONTAINER="$STACK_PROJECT-postgres" KV_TEXTFILE_DIR="$OUT/textfile" BACKUP_DIR="$OUT/backups" bash "$INFRA/backup.sh"
  say "Starting prometheus, alertmanager, blackbox-exporter, node-exporter"
  compose up -d
  local tries=60
  until curl -fsS "http://127.0.0.1:$KV_PROMETHEUS_PORT/-/ready" >/dev/null 2>&1; do
    (( tries-- > 0 )) || { echo "prometheus did not become ready"; compose logs --tail 40 prometheus; exit 1; }
    sleep 2
  done
  echo "  prometheus    http://127.0.0.1:$KV_PROMETHEUS_PORT/targets"
  echo "  alertmanager  http://127.0.0.1:$KV_ALERTMANAGER_PORT/"
}

status() {
  local base="http://127.0.0.1:$KV_PROMETHEUS_PORT"
  python3 - "$base" <<'PY'
import json, sys, urllib.request
base = sys.argv[1]
get = lambda p: json.load(urllib.request.urlopen(base + p, timeout=10))["data"]
print("\ntargets")
for t in sorted(get("/api/v1/targets")["activeTargets"], key=lambda t: (t["labels"]["job"], t["labels"].get("instance", ""))):
    extra = t["labels"].get("probe", "")
    print(f"  {t['health']:<8} {t['labels']['job']:<20} {extra:<14} {t['labels'].get('instance', '')}  {t.get('lastError', '')}")
groups = get("/api/v1/rules")["groups"]
print(f"\nrules: {sum(len(g['rules']) for g in groups)} in {len(groups)} groups")
for g in groups:
    for r in g["rules"]:
        print(f"  {r['state']:<9} {r['health']:<3} {g['name']:<26} {r['name']}")
probes = get("/api/v1/query?query=probe_success")["result"]
print("\nprobe_success")
for p in probes:
    print(f"  {p['value'][1]}  {p['metric'].get('probe', ''):<14} {p['metric']['instance']}")
for q in ("kv_redis_up", "kv_metrics_db_up", "time() - kv_backup_last_success_timestamp_seconds",
          "kv_wal_archive_last_archived_timestamp_seconds", "min(probe_ssl_earliest_cert_expiry - time()) / 86400"):
    res = get("/api/v1/query?query=" + urllib.request.quote(q))["result"]
    print(f"  {q} = {[r['value'][1] for r in res]}")
PY
}

case "${1:-}" in
  check) check ;;
  up) up ;;
  status) status ;;
  down) KV_PROBE_IP=0.0.0.0 KV_TEXTFILE_DIR="$OUT/textfile" KV_STACK_NETWORK="${STACK_PROJECT}_default" compose down --volumes --remove-orphans ;;
  *) sed -n 2p "$0"; exit 2 ;;
esac

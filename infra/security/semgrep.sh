#!/bin/bash
# Usage: bash infra/security/semgrep.sh [extra semgrep args]   (excluded rules are justified in docs/SECURITY.md)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${SEMGREP_IMAGE:-returntocorp/semgrep:1.177.0}"

docker run --rm -e SEMGREP_SEND_METRICS=off -v "$ROOT":/src -w /src "$IMAGE" semgrep scan \
  --metrics=off --error --severity ERROR --severity WARNING \
  --config p/owasp-top-ten --config p/python --config p/react \
  --exclude-rule generic.nginx.security.request-host-used.request-host-used \
  --exclude-rule generic.nginx.security.dynamic-proxy-host.dynamic-proxy-host \
  --exclude node_modules --exclude venv --exclude dist --exclude dist-e2e --exclude infra/build \
  "$@" backend apps packages infra tests

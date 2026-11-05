#!/bin/sh
set -eu
out="${1:-/etc/nginx/applinks}"
app="${APP_BUNDLE_ID:-com.klygenix.play}"
mkdir -p "$out"
rm -f "$out/apple-app-site-association" "$out/assetlinks.json"
team="${APPLE_TEAM_ID:-}"
if [ -n "$team" ]; then
  if printf '%s' "$team" | grep -Eq '^[A-Z0-9]{10}$'; then
    printf '{"applinks":{"details":[{"appIDs":["%s.%s"],"components":[{"/":"/watch/*"},{"/":"/reels/*"},{"/":"/live/*"},{"/":"/@*"},{"/":"/team/accept","?":{"token":"?*"}}]}]}}\n' \
      "$team" "$app" > "$out/apple-app-site-association"
  else
    echo "applinks: APPLE_TEAM_ID is not a 10-character Team ID; apple-app-site-association not served" >&2
  fi
fi
fps="$(printf '%s' "${ANDROID_CERT_SHA256:-}" | tr -d ' ' | tr 'abcdef' 'ABCDEF')"
if [ -n "$fps" ]; then
  if printf '%s\n' "$fps" | tr ',' '\n' | grep -Evq '^([0-9A-F]{2}:){31}[0-9A-F]{2}$'; then
    echo "applinks: ANDROID_CERT_SHA256 must be SHA-256 fingerprints (AA:BB:…, comma-separated); assetlinks.json not served" >&2
  else
    printf '[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"%s","sha256_cert_fingerprints":["%s"]}}]\n' \
      "$app" "$(printf '%s' "$fps" | sed 's/,/","/g')" > "$out/assetlinks.json"
  fi
fi

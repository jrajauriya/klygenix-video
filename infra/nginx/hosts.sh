#!/bin/sh
# HOST_STYLE=nested → studio.play.klygenix.com; flat → play-studio.klygenix.com (one level, covered by Universal SSL).
kv_host() {
  if [ "${HOST_STYLE:-nested}" = "flat" ]; then
    echo "${PUBLIC_DOMAIN%%.*}-$1.${PUBLIC_DOMAIN#*.}"
  else
    echo "$1.$PUBLIC_DOMAIN"
  fi
}
STUDIO_HOST="$(kv_host studio)"
ADMIN_HOST="$(kv_host admin)"
API_HOST="$(kv_host api)"
TV_HOST="$(kv_host tv)"
export STUDIO_HOST ADMIN_HOST API_HOST TV_HOST

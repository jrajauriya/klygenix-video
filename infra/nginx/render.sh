#!/bin/sh
set -eu
. /etc/nginx/hosts.sh
mkdir -p /etc/nginx/snippets
for f in /etc/nginx/snippet-templates/*.conf; do
  envsubst '${PUBLIC_DOMAIN} ${PUBLIC_PORT} ${STUDIO_HOST} ${ADMIN_HOST} ${API_HOST} ${TV_HOST}' < "$f" > "/etc/nginx/snippets/$(basename "$f")"
done
sh /etc/nginx/applinks.sh /etc/nginx/applinks
envsubst '${PUBLIC_DOMAIN} ${PUBLIC_PORT} ${STUDIO_HOST} ${ADMIN_HOST} ${API_HOST} ${TV_HOST}' < /etc/nginx/prod.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'

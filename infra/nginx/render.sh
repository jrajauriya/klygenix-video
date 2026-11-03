#!/bin/sh
set -eu
mkdir -p /etc/nginx/snippets
for f in /etc/nginx/snippet-templates/*.conf; do
  envsubst '${PUBLIC_DOMAIN} ${PUBLIC_PORT}' < "$f" > "/etc/nginx/snippets/$(basename "$f")"
done
envsubst '${PUBLIC_DOMAIN} ${PUBLIC_PORT}' < /etc/nginx/prod.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'

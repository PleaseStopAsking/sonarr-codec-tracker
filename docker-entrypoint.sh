#!/bin/sh
set -eu

: "${SONARR_URL:?Set SONARR_URL to the Sonarr address reachable from this container}"
: "${SONARR_API_KEY:?Set SONARR_API_KEY to your Sonarr API key}"

case "$SONARR_URL" in
    http://*|https://*) ;;
    *) printf '%s\n' "SONARR_URL must start with http:// or https://" >&2; exit 1 ;;
esac

SONARR_URL=${SONARR_URL%/}
escaped_sonarr_url=$(printf '%s' "$SONARR_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf 'var SonarrUrl = "%s";\n' "$escaped_sonarr_url" > /usr/share/caddy/config.js

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
#!/bin/sh
set -eu

SONARR_URL=${SONARR_URL:-}
SONARR_API_KEY=${SONARR_API_KEY:-}
RADARR_URL=${RADARR_URL:-}
RADARR_API_KEY=${RADARR_API_KEY:-}

sonarr_enabled=false
radarr_enabled=false
configure_service() {
    service=$1
    if [ "$service" = SONARR ]; then
        url=$SONARR_URL
        key=$SONARR_API_KEY
    else
        url=$RADARR_URL
        key=$RADARR_API_KEY
    fi

    enabled=false
    if [ -n "$url" ] && [ -n "$key" ]; then
        case "$url" in
            http://*|https://*) ;;
            *) printf '%s\n' "${service}_URL must start with http:// or https://" >&2; exit 1 ;;
        esac
        url=${url%/}
        enabled=true
    else
        if [ -n "$url" ] || [ -n "$key" ]; then
            printf '%s\n' "$service is disabled: both ${service}_URL and ${service}_API_KEY are required" >&2
        fi
        url=http://127.0.0.1:1
        key=
    fi

    if [ "$service" = SONARR ]; then
        SONARR_URL=$url
        SONARR_API_KEY=$key
        sonarr_enabled=$enabled
    else
        RADARR_URL=$url
        RADARR_API_KEY=$key
        radarr_enabled=$enabled
    fi
}
configure_service SONARR
configure_service RADARR

printf '{"sonarr":%s,"radarr":%s}\n' "$sonarr_enabled" "$radarr_enabled" > /usr/share/caddy/services.json
export SONARR_URL SONARR_API_KEY RADARR_URL RADARR_API_KEY

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
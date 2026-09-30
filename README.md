# Codec Tracker

The tracker is served by Caddy in one Docker container. Caddy proxies `/api/*` to Sonarr and adds the Sonarr API key server-side, so the browser uses same-origin requests and does not receive the key.

## Configure

Copy `.env.example` to `.env`, then set:

- `SONARR_URL`: the single Sonarr address used by both the Caddy API proxy and browser series links. It must be reachable from the browser and from inside the container; avoid `localhost`/`127.0.0.1` unless Sonarr shares the container's network namespace. Do not add a trailing slash.
- `SONARR_API_KEY`: a Sonarr API key. Keep `.env` private; do not commit it.

Docker administrators can inspect container environment variables, but the key is not embedded in the image or returned to browsers.
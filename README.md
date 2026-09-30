# Codec Tracker

Codec Tracker is a self-hosted dashboard for exploring Sonarr and Radarr media details in one place. Browse recent additions and searchable, sortable tables with video codec, resolution, and file-size details, then drill into a series’ episodes. API keys stay on the server, never in the browser.

## Configure

Copy `.env.example` to `.env`, then set the URL and API key for each service you want to use:

- `SONARR_URL`: Sonarr's address reachable from the tracker container (for example, `http://sonarr:8989` when both containers share a Docker network).
- `SONARR_API_KEY`: a Sonarr API key. Keep `.env` private; do not commit it.
- `RADARR_URL`: Radarr's address reachable from the tracker container (for example, `http://radarr:7878` on a shared Docker network).
- `RADARR_API_KEY`: a Radarr API key.

Each service is enabled only when both its URL and API key are nonempty. Leave both blank to disable it. The tracker starts with either service, both services, or neither. A disabled service does not appear in navigation or filters, and its API is not queried. If only one setting of a pair is supplied, that service is disabled and a message is logged at startup.

There is no client-side framework. The favicon, app script, stylesheet, and icon bundle are local assets.

## Access control

Caddy adds each key only when proxying the corresponding API request. Anyone who can reach Codec Tracker can still request those routes and read library metadata, including file paths. The included Compose file publishes port 4000 on the host; bind it to `127.0.0.1:4000:4000` or remove the port mapping when using a private reverse proxy or VPN. Restrict access with network policy or authentication.

## Automation

GitHub Actions checks pull requests to `main` with read-only permissions and without publishing. Only the push publishing job has package-write permission. Every push to `main` (including merges) publishes `ghcr.io/<owner>/<repo>:latest` and a `sha-<short-commit>` tag. To publish a semantic version, tag a commit on `main` (for example, `git tag v1.2.3 && git push origin v1.2.3`); the workflow verifies the tagged commit is reachable from `main` before it logs in or publishes `ghcr.io/<owner>/<repo>:v1.2.3`. Tag builds do not move `latest`, and merges do not automatically increment the version. Dependabot checks the Dockerfile base images and npm Lucide dependency weekly and opens update pull requests.
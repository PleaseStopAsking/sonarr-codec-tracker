FROM node:22-alpine AS assets
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM caddy:2.11-alpine

COPY src/index.html /usr/share/caddy/index.html
COPY src/favicon.svg /usr/share/caddy/favicon.svg
COPY src/app.css /usr/share/caddy/app.css
COPY src/app.js /usr/share/caddy/app.js
COPY --from=assets /app/node_modules/lucide/dist/umd/lucide.min.js /usr/share/caddy/lucide.min.js
COPY src/Caddyfile /etc/caddy/Caddyfile
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN apk upgrade --no-cache \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
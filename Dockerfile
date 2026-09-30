FROM caddy:2.11-alpine

COPY src/index.html /usr/share/caddy/index.html
COPY src/Caddyfile /etc/caddy/Caddyfile
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN apk upgrade --no-cache \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
ENV NODE_ENV=production \
    TURSO_DATABASE_URL=file:/tmp/build.db \
    BETTER_AUTH_URL=http://localhost:3000 \
    BETTER_AUTH_SECRET=build-only-placeholder-not-a-runtime-secret
RUN bun run build:binary --target=$(case "$(uname -m)" in x86_64) echo x64 ;; aarch64) echo arm64 ;; *) exit 1 ;; esac) \
    && mv dist/snowtime-linux-* /release

FROM debian:bookworm-slim AS app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home snowtime \
    && mkdir /data && chown snowtime:snowtime /data
WORKDIR /app
COPY --from=build /release/ ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER snowtime
EXPOSE 3000
CMD ["./snowtime"]

FROM caddy:2.11.4 AS caddy
COPY --from=build /release/public/ /srv/snowtime/
COPY deploy/compose/Caddyfile /etc/caddy/Caddyfile

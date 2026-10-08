# The native backend's release image (task 081), from the repository root as the build
# context. The render bundle, its manifest, and the same build's public files must be built
# on the host first (native/crates/render/README.md); the image serves those public files.
# BIN picks the host binary; perf:stress --app=native builds it as snowtime-native:bench.
#
#   docker build -f native/Dockerfile --build-arg BIN=snowtime-axum -t snowtime-native:bench .
FROM rust:1.99-trixie AS build
RUN apt-get update && apt-get install -y --no-install-recommends clang perl make && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY native native
COPY src/lib/holidays/ee.json src/lib/holidays/ee.json
ARG BIN=snowtime-axum
ARG CARGO_FEATURES=
# Bench worktrees share this cache; release builds retain their incremental artifacts.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/native/target \
    cd native && if echo ",${CARGO_FEATURES}," | grep -Eq ",bench,|(^|[ ,])bench([ ,]|$)"; then \
        cargo clean --release -p snowtime-server -p snowtime-render -p snowtime-host; \
    fi \
    && cargo build --release --locked --bin ${BIN} --features "${CARGO_FEATURES}" \
    && cp target/release/${BIN} /server && strip /server

# Optional measurement image: the shared build already vendors OpenSSL.
FROM build AS scrypt-bench
RUN apt-get update \
    && apt-get install -y --no-install-recommends linux-perf \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/native/target \
    cd native && cargo build --release --locked -p snowtime-server --example scrypt-bench --features scrypt-bench \
    && cp target/release/examples/scrypt-bench /scrypt-bench
ENTRYPOINT ["/scrypt-bench"]

FROM debian:trixie-slim AS app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home snowtime \
    && mkdir /data && chown snowtime:snowtime /data
# Named snowtime, as the release image names it, so the bench sampler finds the process.
COPY --from=build /server /app/snowtime
COPY native/crates/render/bundle/dist/public /app/public
ENV HOST=0.0.0.0 PORT=3000 EDGE_STATIC_DIR=/app/public
USER snowtime
EXPOSE 3000
CMD ["/app/snowtime"]

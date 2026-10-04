# The JS bundle is built on the host with the repository's pinned Bun dependencies.
FROM rust:1.99-trixie AS build
RUN apt-get update && apt-get install -y --no-install-recommends clang && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY native /src/native
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/src/native/target \
    cargo build --release --manifest-path native/Cargo.toml -p snowtime-render --bins --examples && \
    cp native/target/release/render-bench /render-bench && \
    cp native/target/release/examples/render-host /render-host
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY --from=build /render-bench /usr/local/bin/render-bench
COPY --from=build /render-host /usr/local/bin/render-host
ENTRYPOINT ["render-bench"]

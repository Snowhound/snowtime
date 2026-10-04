# The renderer's measurement image. The JS bundle is built on the host with the repository's
# pinned Bun dependencies (README.md, "Reproduce").
FROM rust:1.99-trixie AS build
RUN apt-get update && apt-get install -y --no-install-recommends clang && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY native /src/native
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/src/native/target \
    cargo build --release --manifest-path native/Cargo.toml -p snowtime-render --bins && \
    cp native/target/release/render-bench /render-bench
FROM debian:trixie-slim
COPY --from=build /render-bench /usr/local/bin/render-bench
ENTRYPOINT ["render-bench"]

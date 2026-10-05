FROM rust:1.99-trixie AS build
RUN apt-get update && apt-get install -y --no-install-recommends clang
WORKDIR /src
COPY native /src/native
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/src/native/target \
    cargo build --release --manifest-path native/Cargo.toml -p snowtime-render --features api-bench --bins && \
    cp native/target/release/web-api-bench /web-api-bench && \
    cp native/target/release/render-bench /render-bench
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends linux-perf binutils && rm -rf /var/lib/apt/lists/*
COPY --from=build /web-api-bench /usr/local/bin/web-api-bench
COPY --from=build /render-bench /usr/local/bin/render-bench

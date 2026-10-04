# The native backend's release image (task 081), from native/ as the build context. BIN
# picks the host binary; perf:stress --app=native builds it as snowtime-native:bench.
#
#   docker build -f native/Dockerfile --build-arg BIN=snowtime-axum -t snowtime-native:bench native
FROM rust:1.99-slim-trixie AS build
WORKDIR /src
COPY . .
ARG BIN=snowtime-axum
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked --bin ${BIN} \
    && cp target/release/${BIN} /server && strip /server

# Optional measurement image: OpenSSL is vendored, so its build also needs Perl and make.
FROM build AS scrypt-bench
RUN apt-get update \
    && apt-get install -y --no-install-recommends perl make linux-perf \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p snowtime-server --example scrypt-bench --features scrypt-bench \
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
ENV HOST=0.0.0.0 PORT=3000
USER snowtime
EXPOSE 3000
CMD ["/app/snowtime"]

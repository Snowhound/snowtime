FROM snowtime-kit-render:bench
COPY --from=grafana/k6:2.3.0 /usr/bin/k6 /usr/local/bin/k6
WORKDIR /repo
ENTRYPOINT ["bun", "native/bench/perf-gate.ts", "--inside"]

# Native backend

The proof of concept of task 081: the timer's slice of the JSON API in Rust, on the same
SQLite schema as the TypeScript backend, with its own email sign-in. Subtask 03
(`tasks/081-native-backend/03-port-libraries.md`) records what was measured.

## Crates

| Crate            | Holds                                                                        |
| ---------------- | ---------------------------------------------------------------------------- |
| `core`           | The calls, errors, inputs and outputs with validation, clock, and rate limit |
| `auth`           | Better Auth's scrypt hashes, signed session cookie, and session rows         |
| `api`            | The request flow of `src/server/api.server.ts`, free of any HTTP library     |
| `rules-sql`      | The rules with `rusqlite` and SQL strings                                    |
| `rules-seaquery` | The rules with SeaQuery's query builder, run on `rusqlite`                   |
| `server-axum`    | Axum: `snowtime-axum` (SQL strings) and `snowtime-axum-seaquery`             |
| `server-actix`   | Actix Web: `snowtime-actix` (SQL strings)                                    |

Each rules crate mirrors one file of `src/server/` per module, and each function takes
`(db, scope, input)` as its TypeScript counterpart does. An HTTP crate only turns its
library's request into an `api::Request` and back.

## Server rendering

The independent [render crate](crates/render/README.md) embeds V8 and keeps the rerunnable
server-rendering harness. Build its JavaScript bundle before building every workspace
crate. Its HTTP examples demonstrate Axum and Actix; the existing native hosts are wired
after subtask 06 merges.

## Password hashing

Sign-in uses AWS-LC's `EVP_PBE_scrypt` through `aws-lc-sys`, with Better Auth's
parameters and stored hash format unchanged. Subtask 08 records the hash timings, build
costs, memory lifetime, and fixed-load run. AWS-LC builds from bundled C sources with the
C compiler already needed by SQLite. Cross-compiling also needs that target's C compiler
and linker. The tested macOS ARM64 and Linux ARM64 targets use pregenerated bindings and
the `cc` builder, without CMake, Go, or bindgen.

The optional `scrypt-bench` feature adds RustCrypto and vendored OpenSSL for measurement.
It is excluded from the release Docker image. Run each candidate sequentially:

```sh
cargo build --release --manifest-path native/Cargo.toml -p snowtime-auth --example scrypt-bench --features scrypt-bench
native/target/release/examples/scrypt-bench aws-lc 30
native/target/release/examples/scrypt-bench openssl 30
native/target/release/examples/scrypt-bench rust 30
bun native/bench/scrypt.ts 30

docker build --target scrypt-bench -f native/Dockerfile -t snowtime-scrypt:bench native
docker run --rm --cpuset-cpus=1 snowtime-scrypt:bench aws-lc 30
docker run --rm --cpuset-cpus=1 snowtime-scrypt:bench openssl 30
docker run --rm --cpuset-cpus=1 snowtime-scrypt:bench rust 30
docker run --rm --cpuset-cpus=1 -v "$PWD/native/bench:/bench:ro" oven/bun:1.4.2 bun /bench/scrypt.ts 30
```

Each command checks every hash against the Better Auth fixture, discards three warmups,
and reports the median of at least 20 measured hashes. On macOS, vendored OpenSSL needs
Perl and make. The optional Docker stage installs those and `linux-perf` for profiling.

## Run it

The server reads the TypeScript server's environment variables: `TURSO_DATABASE_URL` (a
`file:` URL of a migrated database), `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `HOST`,
`PORT`, `CLIENT_IP_HEADER`, and `NODE_ENV=development` or `DEMO_MODE=true` for password
sign-in. `PERF_NOW`, in milliseconds, moves its clock as `perf/lib/clock.ts` does.

```sh
cargo build --release --manifest-path native/Cargo.toml --all-features
bun native/bench/conformance.ts native/target/release/snowtime-axum
bun native/bench/compare.ts native/target/release/snowtime-axum
```

`conformance.ts` serves the binary a copy of the benchmark database at `SEED_NOW` and
runs `conformance/timer.conformance.ts` against it (or the test files given after the
binary). `compare.ts` sends the same reads to the TypeScript build and the binary and
reports any answer that differs in status, content, or bytes. `lines.ts` counts the code
lines of each ported handler in TypeScript and in the rules crates it's given.
`api-recording.ts` cuts a `perf:stress` recording down to the calls the native backend
serves, for `perf:stress --app=native --recording=<file>`; `native/Dockerfile` builds the
image that run uses.

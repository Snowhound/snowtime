# Native backend

The proof of concept of task 081: the timer's slice of the JSON API in Rust, on the same
SQLite schema as the TypeScript backend, with its own email sign-in. Subtask 03
(`tasks/081-native-backend/03-port-libraries.md`) records what was measured.

## Crates

`server` is the library of application rules and their Axum router. `host` reads the
configuration and serves it as `snowtime-axum`. The library binds no listening socket.

```text
crates/server/src/
  auth/          cookie, password, session, sign_in, routes
  availability/  mod, routes
  entries/       mod (rules), schemas, routes
  projects/      mod (rules), schemas, routes
  timer/         mod (rules), schemas, routes
  http.rs        InOrganization, AsUser, Public, router
  scope.rs       tenancy
  schemas.rs     shared validation and Patch
  queries.rs     shared SQL helpers
  errors.rs · wire.rs · timestamp.rs · clock.rs · rate_limit.rs · timing.rs · config.rs
crates/host/src/
  main.rs · config.rs
```

Each domain's `routes.rs` mirrors the ported paths in its TypeScript routes file. Unported
routes answer 404. The former Actix adapter is in git at
`61467c1:native/crates/server-actix/`; Axum remains provisional until subtask 01.

The host can call `snowtime_server::router(app).oneshot(request)` through tower's
`ServiceExt` (re-exported by `snowtime_server`), forwarding the page request's cookie and the method, path, and body that
`src/lib/api/request.ts` sends. Rendering itself belongs to subtask 01.

## SQL helpers

`queries.rs` holds `sql!`, `Sql`, `Assignments`, and `list`. Only a string literal becomes
SQL text in `sql!`; a fragment carries its parameters along, and other expressions bind
as `?`. The timer, entries, projects, and scope rules use them.

```rust
let users = list(&user_ids);
let query = sql!("select id from time_entry where user_id in ", users);
let ids = query.query(db, |row| row.get::<_, String>(0))?;
```

`Assignments` omits absent patches, binds null for removals, and binds present values.
The connection caches 256 prepared statements instead of rusqlite's default 16, so patch
combinations and user-list lengths have room alongside the fixed queries. The cache stays
bounded; more than 256 distinct statements can still evict older ones.

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
cargo build --release --manifest-path native/Cargo.toml -p snowtime-server --example scrypt-bench --features scrypt-bench
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
cargo build --release --manifest-path native/Cargo.toml --bin snowtime-axum
bun native/bench/conformance.ts native/target/release/snowtime-axum
bun native/bench/compare.ts native/target/release/snowtime-axum
```

`conformance.ts` serves the binary a copy of the benchmark database at `SEED_NOW` and
runs `conformance/timer.conformance.ts` against it (or the test files given after the
binary). `compare.ts` sends the same reads to the TypeScript build and the binary and
fails on any answer that differs in status or bytes. It also compares malformed inputs
and the order of request checks. `lines.ts` counts the code
lines of each ported handler in TypeScript and in the server crate (or a historical rules crate it's given).
`api-recording.ts` cuts a `perf:stress` recording down to the calls the native backend
serves, for `perf:stress --app=native --recording=<file>`; `native/Dockerfile` builds the
image that run uses.

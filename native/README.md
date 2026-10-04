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

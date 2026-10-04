# 081.08: Faster scrypt for sign-in

Status: done (2026-10-04)

Before this task, the native server verified Better Auth's scrypt hashes with `scrypt`
(`native/crates/auth/src/password.rs`). On Linux in Docker, it took 113 ms per hash. Bun's
`node:crypto` took 52 ms. On macOS the two took 59 and 53 ms. Target CPU flags didn't
change it, and neither did keeping glibc from returning scrypt's 32 MB buffer. The cause
was not found in those runs. At load, scrypt was 37–60% of the native app's CPU, and
probably the cause of the native p95 of 84–126 ms (subtask 03, "Load" and "Each candidate at a fixed load").
Kait wants it fixed rather than accepted (2026-10-04).

## Constraints

- **Better Auth's parameters:** N 16384, r 16, p 1, a 64-byte key, the password normalized
  to NFKC, and the salt used as its hex text. scrypt's output is defined by these, so any
  correct implementation gives the same hash; only the speed differs.
  `native/crates/auth/src/password.rs` has a test against a hash from
  `better-auth/crypto`. Keep it passing.
- **Work on branch `081-native-poc`, not `main`.** `native/` exists only there. Branch
  from `081-native-poc` in a worktree of your own, and merge back into it.

## Candidates

- **aws-lc**, through `aws-lc-sys` or `aws-lc-rs` if it exposes scrypt (`EVP_PBE_scrypt`).
  aws-lc is a fork of BoringSSL, which Bun builds on, so it's the closest match to Bun's
  speed. Check what Bun actually uses before relying on that.
- **OpenSSL** through the `openssl` crate (`openssl::pkcs5::scrypt`).
- The `scrypt` crate, profiled: whether Salsa20/8 or the memory pass is slow on Linux in
  Docker, and whether a newer version or a SIMD feature fixes it.

Each C library adds a build dependency to `native/Dockerfile` and to cross-compiling.
Record what each one adds to the build and to the binary's size.

## Measure

Measure time per hash on macOS and on Linux in Docker, for each candidate against Bun.
Then repeat the `perf:stress` fixed-load run of subtask 03 with the chosen candidate:
80,000 users of the slice, Caddy on its own core with `--caddy-cpuset=0`. Compare the
app's CPU and the p95 of returns.

Also record the 32 MB buffer that each running sign-in holds, and whether the chosen
library reuses or frees it.

## Result: AWS-LC

Sign-in now uses AWS-LC 5.7.0 through `aws-lc-sys` 0.45.0. It is the fastest measured
Rust candidate on both targets. The hash format, parameters, NFKC normalization, and
hex-text salt stay the same. OpenSSL and RustCrypto remain behind the optional
`scrypt-bench` feature for comparison; the release Docker build excludes that feature.

Bun 1.4.2 uses **BoringSSL**. Its
[`node:crypto` binding](https://github.com/oven-sh/bun/blob/bun-v1.4.2/src/runtime/node/node_crypto_binding.rs#L1048)
calls `bun_boringssl::c::EVP_PBE_scrypt`, for both the synchronous function and the
asynchronous job. The Rust wrapper
[`aws-lc-rs` 1.18.1](https://docs.rs/aws-lc-rs/1.18.1/aws_lc_rs/) has no scrypt API, so
this implementation calls `aws-lc-sys` directly, with explicit pointer lengths and a
64 MiB memory limit. This accommodates the 32 MiB work buffer and its scratch blocks.

### Time per hash

Measured on 2026-10-04 on an Apple M1 Pro (10 cores), macOS 26.3.1, Rust 1.99.0 /
LLVM 23.1.1, and Linux ARM64 in Docker Desktop (`rust:1.99-slim-trixie`, Debian Trixie). Linux commands
pin the process to core 1. No load test or build ran alongside these measurements.
Every command discards three warmups and takes the median of 30 sequential hashes.
Every output must equal the Better Auth fixture. Password normalization happens before
timing; the salt is the fixture's 32-character hex text. N = 16384, r = 16, p = 1,
and the output is 64 bytes.

| Implementation                              | macOS ms | Linux Docker ms |
| ------------------------------------------- | -------: | --------------: |
| Bun 1.4.2, BoringSSL                        |    54.23 |           54.11 |
| AWS-LC 5.7.0 (`aws-lc-sys` 0.45.0)          |    53.14 |           62.88 |
| OpenSSL 3.6.3 (`openssl` 0.10.81, vendored) |    60.89 |          105.33 |
| RustCrypto `scrypt` 0.12.0                  |    60.47 |          120.05 |

AWS-LC reduces the native Linux hash time by 48%, although it is still 16% slower than
Bun. `native/README.md` has the commands for all four implementations.

### RustCrypto profile

A Linux `perf record -e cpu-clock -F 997` run over 100 hashes collected 12,339 samples,
with none lost. `perf report --stdio --no-children` attributed 86.24% to
`scrypt::block_mix::soft::scrypt_block_mix` (including its inlined Salsa20/8), 10.34% to
`scrypt::scrypt` (the outer ROMix passes), and 1.18% to libc. The dominant cost is the
scalar BlockMix path, rather than allocation. This profile does not explain the whole
macOS/Linux difference within that path.

[`scrypt` 0.12.0's dispatch](https://docs.rs/crate/scrypt/0.12.0/source/src/block_mix.rs)
selects SSE2 on x86 and SIMD128 on WASM, but the scalar implementation on ARM64. There
is no ARM SIMD feature to enable. `salsa20` 0.11.0 also has only its software backend.
These are the latest stable versions in the fetched registry index. The `parallel`
feature distributes p independent ROMix blocks and cannot help when p = 1. Subtask 03
already tried target CPU flags and allocator retention without an improvement.

To repeat the profile in the optional Docker image:

```sh
docker run --rm --privileged --cpuset-cpus=1 --entrypoint sh snowtime-scrypt:bench -c \
  'perf record -e cpu-clock -F 997 -o /tmp/scrypt.data /scrypt-bench rust 100 && perf report -i /tmp/scrypt.data --stdio --no-children --percent-limit 1'
```

### Build costs

Clean `snowtime-axum` release builds, one isolated copy per candidate with only that
password implementation enabled, empty target directories, and cached registry files.
The Linux builds use the Dockerfile's Rust image and compiler toolchain. Times cover
Cargo compilation and linking, excluding registry downloads, package installation, and
image export. Sizes follow `strip`; MB is decimal.

| Password implementation | macOS build s | macOS stripped MB | Linux build s | Linux stripped MB |
| ----------------------- | ------------: | ----------------: | ------------: | ----------------: |
| RustCrypto              |         23.87 |             3.687 |         47.21 |             3.822 |
| AWS-LC                  |         32.38 |             4.366 |         52.38 |             3.887 |
| Vendored OpenSSL        |         45.58 |             6.947 |         52.61 |             7.970 |

- **AWS-LC:** adds a statically linked C library. Both measured targets use its `cc`
  builder and pregenerated bindings. The release Dockerfile needs no extra apt packages:
  the Rust image already has the C compiler and binutils used by bundled SQLite. The
  measured build adds 8.51 s / 5.17 s and 0.680 MB / 0.066 MB on macOS / Linux. There is
  no runtime crypto package. Cross-compilation needs the target C compiler and linker.
  Default non-FIPS builds use shipped bindings; explicitly enabling bindgen or the
  CMake builder adds those tools.
- **OpenSSL:** the measured vendored build needs Perl and make alongside the target C
  compiler. The optional Docker stage installs `perl make`; macOS uses the existing
  developer tools and Perl. Cross-compilation needs the target C compiler/linker and
  OpenSSL's target configuration. Static linking adds no runtime package. It adds
  21.71 s / 5.40 s and 3.261 MB / 4.148 MB over RustCrypto.
- **RustCrypto:** adds no C hashing library or build tools.

The release Dockerfile strips the server and enables the SeaQuery server feature
explicitly instead of `--all-features`, so all three server binaries remain buildable
without enabling the benchmark's OpenSSL dependency.

### Buffer lifetime

AWS-LC's
[`EVP_PBE_scrypt`](https://docs.rs/crate/aws-lc-sys/0.45.0/source/aws-lc/crypto/evp_extra/scrypt.c)
allocates one zeroed block with `OPENSSL_calloc` and calls `OPENSSL_free` on both success
and failure. At these parameters it holds 33,558,528 bytes: 32 MiB for V and 4 KiB for
B and T. Each running sign-in holds its own buffer. The library frees it per hash and
keeps no pool for reuse. Whether the allocator returns those pages to the OS is separate
from this library-level free. RustCrypto likewise allocates and drops its V, B, and T
vectors per hash; switching libraries does not eliminate the concurrent-sign-in memory
cost.

### Validation

`cargo test --manifest-path native/Cargo.toml` passes all 10 tests, including the
existing `better-auth/crypto` fixture and a new Bun fixture that checks NFKC and an
embedded NUL. The latter checks that the C call uses byte lengths rather than stopping
at the NUL. `conformance.ts` passes 13 of 13 tests. `compare.ts` returns the same status
and bytes for all 22 calls against the TypeScript build.

### Fixed load

The fixed-load run uses the same M database, users, and slice recording as subtask 03,
copied into this task's worktree. Caddy has core 0, the app and sampler have core 1,
and k6 has cores 2–9. The command keeps the Mac awake:

```sh
caffeinate -i bun run perf:stress --app=native --dataset=M --run=fixed \
  --users=80000 --seconds=120 --recording=perf/.cache/stress/slice.json \
  --caddy-cpuset=0 --label=081-fast-scrypt
```

All runs below serve 80,000 users of the slice for 120 seconds. Return p95 is the
client's full request time, as in subtask 03's comparison. The old rows are retained for
comparison; the additional RustCrypto control uses the old password code with the same
current dataset, recording, Caddy image, and CPU placement as the AWS-LC runs.

| Axum, SQL strings                | Offered req/s |     App CPU | Anon MB | RSS peak MB | Return p95 ms | Sign-in p50 ms |
| -------------------------------- | ------------: | ----------: | ------: | ----------: | ------------: | -------------: |
| Subtask 03, RustCrypto, two runs |        ~1,050 | 42.7, 40.5% |  43, 39 |    123, 100 |       126, 88 |              — |
| AWS-LC, first run                |       1,021.5 |       35.2% |     105 |         176 |           491 |             93 |
| RustCrypto, control              |       1,027.8 |       45.3% |      99 |         224 |           525 |            195 |
| AWS-LC, second run               |       1,022.5 |       35.9% |     105 |         144 |           821 |             97 |

AWS-LC reduces app CPU by 9.4–10.1 percentage points (21–22%) against today's control
and halves median sign-in time. It does **not** show an improvement in return p95: both
current candidates have much worse tails than subtask 03. All three runs miss latency
targets. Today's runs report 7–9% app I/O pressure, 38–42% Caddy CPU, and 361–397 MB
Caddy RSS, versus 4% I/O pressure, 26.9% Caddy CPU, and 91 MB Caddy RSS in subtask 03's
second Axum run. The cause of the changed load behavior was not isolated, so these
results establish the hash and CPU improvement, not a capacity or latency improvement.
There were no OOM kills. The runs also returned 34, 26, and 49 4xx responses respectively;
the harness still has subtask 03's shared-user timer collision problem.

The first run builds the images. The control and second run use `--no-build` after
building each native image separately. Both the recording bytes and Caddy's actual
`cpuset=0` / app's `cpuset=1` were checked. Raw results remain in this worktree's
`perf/.cache/stress/runs/`:

- `2026-10-04T12-34-13-M-fixed-081-fast-scrypt`
- `2026-10-04T12-39-40-M-fixed-081-scrypt-baseline`
- `2026-10-04T12-42-04-M-fixed-081-fast-scrypt-2`

## Acceptance criteria

- [x] Time per hash for each candidate on both platforms, against Bun
- [x] One chosen, with its build cost, and the hash test passing
- [x] The fixed-load run repeated, with the p95 and CPU recorded in subtask 03's section or
      here
- [x] Merged into `081-native-poc`

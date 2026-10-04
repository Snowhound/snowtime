# 081.08: Faster scrypt for sign-in

Status: todo

The native server verifies Better Auth's scrypt password hashes with the `scrypt` crate
(`native/crates/auth/src/password.rs`). On Linux in Docker, it takes 113 ms per hash. Bun's
`node:crypto` takes 52 ms. On macOS the two take 59 and 53 ms. Target CPU flags didn't
change it, and neither did keeping glibc from returning scrypt's 32 MB buffer. The cause
isn't found. At load, scrypt was 37–60% of the native app's CPU, and probably the cause of
the native p95 of 84–126 ms (subtask 03, "Load" and "Each candidate at a fixed load").
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

## Acceptance criteria

- [ ] Time per hash for each candidate on both platforms, against Bun
- [ ] One chosen, with its build cost, and the hash test passing
- [ ] The fixed-load run repeated, with the p95 and CPU recorded in subtask 03's section or
      here
- [ ] Merged into `081-native-poc`

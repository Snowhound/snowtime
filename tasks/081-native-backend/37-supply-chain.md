# 081.37: Supply chain and harness

Status: done

Prepare the native backend's supply chain and test harness for the repository split: M7's
reqwest part, M8, M9, and L21–L24 from task 081.30, and its `rand` advisory. Branch
`081-supply-chain`, from `081-audit` at `ae0ec17`, after 081.35's merge. No Docker, load,
or stress runs.

## Acceptance criteria

- [x] M7: reqwest is a caret requirement (`0.12.28`) with
      `rustls-tls-webpki-roots-no-provider`. The host installs AWS-LC at startup, and
      `oauth::tests::the_provider_client_uses_the_installed_aws_lc_provider` installs it
      before building both OAuth clients; no other server test builds one. The host's
      test-only `rcgen` uses AWS-LC too, so `cargo tree -i ring` prints nothing for any
      target or feature. OpenSSL and `webauthn-rs-core` stay, as 081.28 decided.
- [x] M8: `native/v8-archive.sh` reads the v8 version from `Cargo.lock`, downloads that
      release's `librusty_v8_simdutf_release_<arch>-unknown-linux-gnu.a.gz`, and checks a
      pinned SHA-256; the Dockerfile and CI set `RUSTY_V8_ARCHIVE` to it. An unpinned
      version or architecture fails the build. **The image build is unverified**: no
      `docker build` ran. The script ran on macOS with `uname` reporting `aarch64` (hash
      OK) and with the real `arm64` (refused).
- [x] M9: `native/licenses/generate.sh` writes `native/THIRD_PARTY_LICENSES` (cargo-about
      0.9.2, Linux targets, no build or dev dependencies, our crates omitted), then appends
      V8's and its bundled libraries' licenses (`native/licenses/v8/`), OpenSSL's, AWS-LC's,
      and zstd's from their crates' sources, the MIT license of the vendored `deno_fetch`
      scripts, and SQLite's public-domain note. The image copies it to
      `/usr/share/doc/snowtime/`, and CI fails when it's stale. Two runs give the same bytes.
- [x] L21: `native/README.md` builds with `--features bench` for conformance and
      `compare.ts`. The OAuth flow masks `createdAt`, `updatedAt`, and `signedInAt` by field
      name, so equal values keep their own aliases.
- [x] L22: the `auth-spike` feature, `native/crates/server/src/auth/spike/`,
      `native/bench/auth-spike/`, and their dependencies are gone; 114 crates leave
      `Cargo.lock`, and no locked version changed. Knip, `package.json`, `native/README.md`,
      and `auth-spike.md` no longer refer to them.
- [x] L23: `native/rust-toolchain.toml` pins 1.99.0, the workspace sets
      `rust-version = "1.99"`, and both Dockerfile base images are pinned by digest (the
      Rust image ships 1.99.0). `[workspace.lints]` sets clippy's
      `undocumented_unsafe_blocks`, and every `unsafe` block, Linux-only ones included, has
      a `SAFETY:` comment. `.github/workflows/native.yml` runs fmt, both Clippy modes, the
      Rust tests, both `cargo deny` checks, `cargo audit`, and the license check.
- [x] `cargo audit` passes with no ignores. RUSTSEC-2026-0097: `rand` 0.8.5 updated to
      0.8.8, a fixed release; the locked 0.9.5 and 0.10.3 were already fixed.
- [x] page-compare: script and style names are masked as `/assets/<name>-$hash.<ext>`, with
      hyphens and underscores allowed in both name and hash, so a control binary from
      another frontend build compares cleanly. `native/README.md` documents it, and CI runs
      it on a pull request that leaves `src/` alone, against the base commit's host.
- [x] L24: `conformance/tenancy.conformance.ts`. Adam, a Northwind admin and Harbor owner,
      acts under Northwind with Harbor's entry, projects, team, and membership IDs: 16
      calls refused alike on TypeScript and native, a report filtered by Harbor's project
      empty, and Harbor's entries, projects, teams, and members unchanged.

## Decision: LGPL code in V8

V8's `third_party/glibc` (`sin`, `cos`, and `__branred`, forked from glibc) is under
LGPL-2.1, and the host binary links it: `nm` on the debug binary shows `glibc_sin`,
`glibc_cos`, and `__branred`. 081.30's "no GPL, LGPL, or AGPL in the release graph"
covered only the Cargo graph.

LGPL-2.1's terms apply when a binary goes to someone else, not when it runs. Kait decided
on 2026-10-09 that the notices are enough, with two additions:

- `THIRD_PARTY_LICENSES` links the glibc code's source at the V8 revision the locked v8
  crate pins, and says how to relink: build from source with `RUSTY_V8_ARCHIVE` set to a
  modified library.
- `native/README.md` says so too, and asks anyone who hands a built binary or image to
  others to ship `THIRD_PARTY_LICENSES` with it. Porting kit users who build and run on
  their own servers owe nothing more.

Images in a private GHCR repository that only our deployments pull aren't distributed.
Giving anyone outside the organization access to them is, and the two additions cover it.

## Verification

Run 2026-10-09 on macOS arm64 with the commands from the task prompt.

| Check                    | Before, `ae0ec17`    | This branch          |
| ------------------------ | -------------------- | -------------------- |
| Server tests, each mode  | 122                  | 123                  |
| Host tests               | 35                   | 35                   |
| Render tests             | 18, 1 ignored        | 18, 1 ignored        |
| Conformance              | 54 / 539 in 11 files | 55 / 542 in 12 files |
| `compare.ts` byte-equal  | 1,409                | 1,409                |
| `hardening-compare.ts`   | 17 checks            | 17                   |
| `page-compare.ts`        | 59 / 59              | 59 / 59              |
| `cargo deny`, both modes | pass                 | pass                 |
| `cargo audit`            | fails on `rsa`       | pass, no ignores     |

`cargo fmt --check`, both Clippy runs, the `bench` build, `bunx tsc --noEmit`, and
`bunx knip` passed. The task prompt's baseline counts were from 081.35's start at
`c7634a5` (118 server, 29 host tests); 081.35's fixes brought them to 122 and 35, as its
record shows. The new server
test is the OAuth client's provider check; the new conformance file is
`tenancy.conformance.ts`, which also passes against TypeScript (`bun test`).

`page-compare.ts` used a control built in the `snowtime-081-poc` worktree at `ae0ec17`,
from that worktree's own frontend build, which 081.35 couldn't compare cleanly; with the
asset mask, all 59 pages are byte-equal.

The CI workflow hasn't run: the branch isn't pushed.

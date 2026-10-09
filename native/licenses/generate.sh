#!/bin/sh
# Regenerates native/THIRD_PARTY_LICENSES, the notices the release image ships: the Rust
# crates of the Linux release graph from cargo-about, then the C, C++, and JavaScript code
# they build in. OpenSSL's, AWS-LC's, and zstd's files come from their crates' sources; V8's
# crate ships none, so v8/ holds them (README.md).
set -eu
cd "$(dirname "$0")/.."
out=THIRD_PARTY_LICENSES
# The V8 revision rusty_v8 pins for the locked v8 crate; it changes with the crate.
v8_revision=73d19698991616a34a00ca691a6e697dbb69e2ef

cargo about generate --frozen --fail -c licenses/about.toml licenses/about.hbs -o "$out"

# The one locked source directory of a crate, from cargo metadata.
crate_dir() {
  dirs=$(cargo metadata --frozen --format-version 1 |
    grep -o "\"manifest_path\":\"[^\"]*/$1-[0-9][^\"/]*/Cargo.toml\"" | sort -u)
  if [ "$(printf '%s\n' "$dirs" | grep -c .)" -ne 1 ]; then
    echo "expected one locked $1, found: $dirs" >&2
    exit 1
  fi
  printf '%s\n' "$dirs" | sed 's/^"manifest_path":"//; s#/Cargo.toml"$##'
}

section() {
  printf '\n================================================================================\n%s\n' "$1"
  printf -- '--------------------------------------------------------------------------------\n\n'
  cat "$2"
}

{
  section "V8, through the v8 crate (rusty_v8): rusty_v8" licenses/v8/rusty_v8.LICENSE
  section "V8" licenses/v8/v8.LICENSE
  section "V8: LICENSE.v8" licenses/v8/v8.LICENSE.v8
  section "V8: fdlibm" licenses/v8/v8.LICENSE.fdlibm
  section "V8: Strongtalk assembler" licenses/v8/v8.LICENSE.strongtalk
  section "V8: glibc math functions (third_party/glibc, LGPL-2.1)" licenses/v8/v8-glibc.LICENSE
  printf '\nSource: https://github.com/denoland/v8/tree/%s/third_party/glibc\n' "$v8_revision"
  printf 'To relink against a modified V8, build the host from source with RUSTY_V8_ARCHIVE set\n'
  printf 'to the modified library (native/README.md, "Supply chain").\n'
  section "V8: inspector protocol" licenses/v8/v8-inspector_protocol.LICENSE
  section "V8: rapidhash" licenses/v8/v8-rapidhash-v8.LICENSE
  section "V8: SipHash" licenses/v8/v8-siphash.LICENSE
  section "V8: UTF-8 decoder" licenses/v8/v8-utf8-decoder.LICENSE
  section "V8: Abseil" licenses/v8/abseil.LICENSE
  section "V8: dragonbox" licenses/v8/dragonbox.LICENSE-Boost
  section "V8: fast_float" licenses/v8/fast_float.LICENSE-MIT
  section "V8: FP16" licenses/v8/fp16.LICENSE
  section "V8: Highway" licenses/v8/highway.LICENSE
  section "V8: ICU" licenses/v8/icu.LICENSE
  section "V8: libc++" licenses/v8/libcxx.LICENSE
  section "V8: libc++abi" licenses/v8/libcxxabi.LICENSE
  section "V8: LLVM libc" licenses/v8/llvm-libc.LICENSE
  section "V8: simdutf" licenses/v8/simdutf.LICENSE
  section "OpenSSL, through openssl-src" "$(crate_dir openssl-src)/openssl/LICENSE.txt"
  section "AWS-LC, through aws-lc-sys" "$(crate_dir aws-lc-sys)/aws-lc/LICENSE"
  section "Zstandard, through zstd-sys" "$(crate_dir zstd-sys)/zstd/LICENSE"
  section "Deno's fetch scripts (crates/render/vendor/deno_fetch)" crates/render/vendor/deno_fetch/LICENSE
  printf '\n================================================================================\n'
  printf 'SQLite, through libsqlite3-sys, is in the public domain.\n'
} >>"$out"

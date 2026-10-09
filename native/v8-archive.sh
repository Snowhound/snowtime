#!/bin/sh
# Downloads the prebuilt V8 library for the v8 crate in Cargo.lock and checks its SHA-256,
# for RUSTY_V8_ARCHIVE; the crate's build script would download it without a content
# check. Linux only, as the release image and CI build there. When the v8 crate changes, add
# its version's hashes (curl the two assets and run sha256sum) and keep the old ones while
# CI still builds a base commit that locks them.
#
#   native/v8-archive.sh native/Cargo.lock /opt/librusty_v8.a.gz
set -eu
lock=$1
out=$2

version=$(grep -A1 '^name = "v8"$' "$lock" | sed -n 's/^version = "\(.*\)"$/\1/p')
arch=$(uname -m)
case "$version/$arch" in
  149.4.0/x86_64) sum=aa30f198b6e7be2188df6498f95053c4c052f212037a01f2c31414d7aca84b53 ;;
  149.4.0/aarch64) sum=54f779336fa85d16ea7950f82d3b8b31326ae09bac84d59763db2c5ceaa0094c ;;
  *)
    echo "No pinned V8 library for v8 $version on $arch" >&2
    exit 1
    ;;
esac
curl -fsSL -o "$out" \
  "https://github.com/denoland/rusty_v8/releases/download/v$version/librusty_v8_simdutf_release_$arch-unknown-linux-gnu.a.gz"
echo "$sum  $out" | sha256sum -c -

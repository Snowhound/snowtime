#!/bin/bash
# fetch-jsc.sh: downloads the jsc shell of Bun 1.4.2's WebKit (oven-sh/WebKit
# autobuild-2e2aa229, the `webkit` of `bun -e 'console.log(process.versions)'`), LTO and
# plain builds, and builds the web API polyfills into $OUT.
set -e
source "$(dirname "$0")/env.sh"
tag=autobuild-2e2aa2290fac856d6f451ceacb58f7f5b44dd057
mkdir -p "$JSC_ROOT"
for variant in lto plain; do
  file=bun-webkit-linux-amd64.tar.gz
  [ $variant = lto ] && file=bun-webkit-linux-amd64-lto.tar.gz
  [ -x "$JSC_ROOT/$variant/bun-webkit/bin/jsc" ] && continue
  curl -sSL -o "$JSC_ROOT/$file" "https://github.com/oven-sh/WebKit/releases/download/$tag/$file"
  mkdir -p "$JSC_ROOT/$variant"
  tar -xzf "$JSC_ROOT/$file" -C "$JSC_ROOT/$variant"
done
docker run --rm -v "$B/bench:/bench" -w /bench oven/bun:1.4.2 sh -c \
  'bun install --frozen-lockfile >/dev/null && bun build jsc/polyfills.js --target browser --format iife --outfile /tmp/p.js >/dev/null && cat /tmp/p.js' \
  > "$OUT/polyfills.iife.tmp" && mv "$OUT/polyfills.iife.tmp" "$OUT/polyfills.iife.js" || exit 1
echo "jsc: $JSC_ROOT/{lto,plain}/bun-webkit/bin/jsc, polyfills: $OUT/polyfills.iife.js"

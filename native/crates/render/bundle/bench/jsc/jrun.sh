#!/bin/bash
# jrun.sh <page> [count] ["<jsc options>"] [bundle file] [lto|plain]
# One jsc-bench run under the measurement limits; prints its PHASES lines and JSON result.
# The page's first render goes to $OUT/html/jsc-<page>.html.
source "$(dirname "$0")/env.sh"
page=$1 count=${2:-500} opts=${3:-} bundle=${4:-render.phase.js} variant=${5:-lto}
mkdir -p "$OUT/html"
docker run --rm --cpus=1 --memory=2g -e RUN_JSC_SMAPS -v "$RESULTS:/results:ro" \
  -v "$B/dist:/dist:ro" -v "$H:/h:ro" -v "$OUT:/o" \
  -v "$JSC_ROOT/$variant/bun-webkit/bin/jsc:/usr/local/bin/jsc:ro" node:24-slim \
  node /h/run-jsc.mjs /usr/local/bin/jsc "$opts" /o/polyfills.iife.js /dist/$bundle \
  /dist/manifest.json /results/$page.json /results/answers.json $count /o/html/jsc-$page.html

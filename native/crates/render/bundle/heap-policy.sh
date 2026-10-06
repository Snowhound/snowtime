#!/bin/bash
# Diagnostic only: the host supplies its own memory policy.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
image=${1:-snowtime-render:allocation-final}
out=$PWD/native/crates/render/results/allocation/heap-policy
mkdir -p "$out"
for round in 1 2 3; do
  for page in timer week month year; do
    heaps=(128 256)
    [ "$round" != 2 ] || heaps=(256 128)
    for heap in "${heaps[@]}"; do
      docker run --rm --cpus=1 --memory=2g -e RENDER_HEAP_MB="$heap" \
        -v "$PWD/native/crates/render/results:/results" "$image" \
        render-bench "/results/$page.json" /results/answers.json 500 1 1 \
        "/results/$page-heap-$heap.html" > "$out/$page-$heap-$round.json"
    done
    cmp "native/crates/render/results/$page-heap-128.html" \
      "native/crates/render/results/$page-heap-256.html"
  done
done

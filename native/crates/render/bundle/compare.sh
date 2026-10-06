#!/bin/bash
# Alternate isolated whole-render comparisons against unchanged captures.
set -euo pipefail
if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  echo "compare.sh <control-image> <candidate-image> <output-directory> [bun-bundle]" >&2
  exit 1
fi
cd "$(dirname "$0")/../../../.."
control=$1
candidate=$2
out=$3
mkdir -p "$out"
results="$PWD/native/crates/render/results"
bun_env=()
[ "$#" -lt 4 ] || bun_env=(-e "BUN_RENDER_BUNDLE=$4")
for round in 1 2 3; do
  for page in timer week month year; do
    modes=(control candidate)
    [ "$round" != 2 ] || modes=(candidate control)
    for mode in "${modes[@]}"; do
      image=$control
      [ "$mode" != candidate ] || image=$candidate
      docker run --rm --cpus=1 --memory=2g -v "$results:/results" "$image"         render-bench "/results/$page.json" /results/answers.json 500 1 1         "/results/$page-$mode.html" > "$out/$page-$mode-$round.json"
    done
    cmp "$results/$page-control.html" "$results/$page-candidate.html"
    docker run --rm --cpus=1 --memory=2g -v "$PWD:/work" -w /work "${bun_env[@]}"       oven/bun:1.4.2 bun native/crates/render/bundle/bun-bench.ts       "native/crates/render/results/$page.json" native/crates/render/results/answers.json       500 > "$out/$page-bun-$round.json"
  done
done

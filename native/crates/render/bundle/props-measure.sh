#!/usr/bin/env bash
# Three alternating rounds of the plain and shared props bundles on V8 (default
# and 32 MiB semi-space) and Bun, after building snowtime-render:props-<variant> images.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
results="$(pwd)/native/crates/render/results"
out="$results/props"
mkdir -p "$out/html" "$out/raw"
for variant in plain shared; do
  cp "native/crates/render/bundle/dist/render$([ $variant = plain ] || echo .$variant).js" \
    "$out/render.measured.$variant.js"
done
for round in 1 2 3; do
  for page in timer week month year; do
    variants=(plain shared)
    if [ "$round" = 2 ]; then variants=(shared plain); fi
    for variant in "${variants[@]}"; do
      for semi in default 32; do
        envs=()
        if [ "$semi" = 32 ]; then envs=(-e RENDER_SEMI_MB=32); fi
        docker run --rm --cpus=1 --memory=2g -v "$results:/results:ro" -v "$out/html:/html" ${envs[@]+"${envs[@]}"} \
          "snowtime-render:props-$variant" "/results/$page.json" /results/answers.json 500 1 1 \
          "/html/$page-v8-$semi-$variant.html" > "$out/raw/$page-v8-$semi-$variant-$round.json"
      done
      docker run --rm --cpus=1 --memory=2g --entrypoint bun -e RENDER_PROPS="$variant" \
        -v "$(pwd):/work:ro" -v "$out/html:/html" -w /work oven/bun:1.4.2 \
        native/crates/render/bundle/bun-bench.ts "/work/native/crates/render/results/$page.json" \
        /work/native/crates/render/results/answers.json 500 "/html/$page-bun-$variant.html" > "$out/raw/$page-bun-$variant-$round.json"
    done
    for engine in v8-default v8-32 bun; do
      cmp "$out/html/$page-$engine-plain.html" "$out/html/$page-$engine-shared.html"
    done
    echo "round $round $page: HTML identical"
  done
done

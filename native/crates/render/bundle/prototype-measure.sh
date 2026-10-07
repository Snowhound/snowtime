#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
results="$(pwd)/native/crates/render/results"
out="$results/prototype"
mkdir -p "$out/html" "$out/raw"
for round in 1 2 3; do
  for page in timer week month year; do
    variants=(plain prototype)
    if [ "$round" = 2 ]; then variants=(prototype plain); fi
    for variant in "${variants[@]}"; do
      if [ "$variant" = plain ]; then image=snowtime-render:prototype19-plain; flag=0
      else image=snowtime-render:prototype19; flag=1; fi
      for semi in default 32; do
        envs=()
        if [ "$semi" = 32 ]; then envs=(-e RENDER_SEMI_MB=32); fi
        docker run --rm --cpus=1 --memory=2g -v "$results:/results:ro" -v "$out/html:/html" "${envs[@]}" "$image" \
          "/results/$page.json" /results/answers.json 500 1 1 "/html/$page-v8-$semi-$variant.html" > "$out/raw/$page-v8-$semi-$variant-$round.json"
      done
      docker run --rm --cpus=1 --memory=2g --entrypoint bun -e RENDER_PROTOTYPE_PROPS="$flag" \
        -v "$(pwd):/work:ro" -v "$out/html:/html" -w /work oven/bun:1.4.2 \
        native/crates/render/bundle/bun-bench.ts "/work/native/crates/render/results/$page.json" \
        /work/native/crates/render/results/answers.json 500 "/html/$page-bun-$variant.html" > "$out/raw/$page-bun-$variant-$round.json"
    done
    for engine in v8-default v8-32 bun; do
      cmp "$out/html/$page-$engine-plain.html" "$out/html/$page-$engine-prototype.html"
    done
    echo "round $round $page: HTML identical"
  done
done

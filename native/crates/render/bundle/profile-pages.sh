#!/bin/bash
set -eu
cd "$(dirname "$0")/../../../.."
image=${1:-snowtime-render:api-bench}
results=$PWD/native/crates/render/results
folder=${2:-allocation}
out=$results/$folder
mkdir -p "$out"
for page in timer week month year; do
 for mode in plain cpu allocation; do
  envs=()
  [ "$mode" != cpu ] || envs=(-e RENDER_CPU_PROFILE=/results/$folder/$page.cpuprofile)
  [ "$mode" != allocation ] || envs=(-e RENDER_ALLOCATION_PROFILE=/results/$folder/$page.heapprofile)
  docker run --rm --cpus=1 --memory=2g -v "$results:/results" "${envs[@]}" "$image" render-bench /results/$page.json /results/answers.json 500 1 1 /results/$page-v8.html > "$out/$page-$mode.json"
 done
 for mode in plain profile; do
  envs=()
  [ "$mode" != profile ] || envs=(-e BUN_RENDER_PROFILE=/work/native/crates/render/results/$folder/$page.jsc.json)
  docker run --rm --cpus=1 --memory=2g -v "$PWD:/work" -w /work "${envs[@]}" oven/bun:1.4.2 bun native/crates/render/bundle/bun-bench.ts native/crates/render/results/$page.json native/crates/render/results/answers.json 500 > "$out/$page-bun-$mode.json"
 done
done

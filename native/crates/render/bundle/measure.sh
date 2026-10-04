#!/bin/sh
set -eu
cd "$(dirname "$0")/../../../.."
docker build -f native/crates/render/Dockerfile -t snowtime-render:bench .
results="$PWD/native/crates/render/results"
: > "$results/linux.jsonl"
for run in 1 2 3; do
  for page in timer week; do
    for mode in local thread; do
      docker run --rm --cpus=1 --memory=2g -v "$results:/results" snowtime-render:bench \
        "$mode" "/results/$page.json" /results/answers.json 500 "/results/$page-v8.html" >> "$results/linux.jsonl"
    done
  done
done
cat "$results/linux.jsonl"
docker run --rm --cpus=1 --memory=2g --entrypoint python3 \
  -v "$results:/results:ro" \
  -v "$PWD/native/crates/render/bundle/framework-bench.py:/framework-bench.py:ro" \
  snowtime-render:bench /framework-bench.py > "$results/framework.jsonl"
cat "$results/framework.jsonl"

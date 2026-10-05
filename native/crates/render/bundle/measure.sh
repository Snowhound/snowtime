#!/bin/sh
# Linux measurements of the renderer in Docker (task 081.01), against capture.ts's answers.
#   measure.sh pages       each page, three runs of 500 renders, one renderer, one CPU
#   measure.sh renderers   the timer with 1 to 4 renderers and as many clients, four CPUs
#   measure.sh long        the timer for 5,000 renders, with glibc's default arenas and two
set -eu
cd "$(dirname "$0")/../../../.."
docker build -f native/crates/render/Dockerfile -t snowtime-render:bench .
results="$PWD/native/crates/render/results"
bench() {
  cpus=$1
  shift
  docker run --rm --cpus="$cpus" --memory=2g -v "$results:/results" "$@"
}
case "${1:-pages}" in
pages)
  : > "$results/linux.jsonl"
  for run in 1 2 3; do
    for page in timer week month year; do
      bench 1 snowtime-render:bench "/results/$page.json" /results/answers.json 500 1 1 \
        "/results/$page-v8.html" >> "$results/linux.jsonl"
    done
  done
  cat "$results/linux.jsonl"
  ;;
renderers)
  : > "$results/renderers.jsonl"
  for run in 1 2 3; do
    for n in 1 2 3 4; do
      bench 4 snowtime-render:bench /results/timer.json /results/answers.json 1000 "$n" "$n" \
        >> "$results/renderers.jsonl"
    done
  done
  cat "$results/renderers.jsonl"
  ;;
long)
  : > "$results/long.jsonl"
  for arenas in default 2; do
    env=""
    [ "$arenas" = default ] || env="-e MALLOC_ARENA_MAX=$arenas"
    # shellcheck disable=SC2086
    bench 1 $env snowtime-render:bench /results/timer.json /results/answers.json 5000 1 1 \
      >> "$results/long.jsonl"
  done
  cat "$results/long.jsonl"
  ;;
esac

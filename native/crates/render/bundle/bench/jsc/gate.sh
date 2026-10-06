#!/bin/bash
# gate.sh [rounds] [pages] [engines]: the task 081.16 gate. Runs the phase-timed bundle
# (dist/render.phase.js) in the V8 crate (image snowtime-render:phase), Bun 1.4.2, and the
# jsc shell, alternating the engine order each round, and prints one summary line per run.
# Raw output goes to $OUT/raw/<engine>-<page>-<round>.txt. Stop other containers first.
source "$(dirname "$0")/env.sh"
rounds=${1:-3}
pages=${2:-timer week month year}
read -ra engines <<< "${3:-v8 bun jsc jsc-bunopts}"
mkdir -p "$OUT/raw"
run() { # engine page round
  local out=$OUT/raw/$1-$2-$3.txt
  case $1 in
    v8) docker run --rm --cpus=1 --memory=2g -v "$RESULTS:/results:ro" snowtime-render:phase \
          /results/$2.json /results/answers.json 500 1 1 ;;
    bun) docker run --rm --cpus=1 --memory=2g -v "$RESULTS:/results:ro" -v "$B:/b" -w /b \
           -e BUN_RENDER_BUNDLE=/b/dist/render.phase.js oven/bun:1.4.2 \
           bun bun-bench.ts /results/$2.json /results/answers.json 500 ;;
    jsc) "$H/jrun.sh" $2 500 "" ;;
    jsc-bunopts) "$H/jrun.sh" $2 500 "$BUNOPTS" ;;
    jsc-plain) "$H/jrun.sh" $2 500 "" render.phase.js plain ;;
    # Bun's runtime re-print of the bundle: bun build --no-bundle --minify-syntax --target=bun
    jsc-bunsrc) "$H/jrun.sh" $2 500 "$BUNOPTS" render.phase.bun.js ;;
    jsc-noftl) "$H/jrun.sh" $2 500 "$BUNOPTS --useFTLJIT=0" ;;
    jsc-nodfg) "$H/jrun.sh" $2 500 "$BUNOPTS --useDFGJIT=0" ;;
    jsc-1marker) "$H/jrun.sh" $2 500 "$BUNOPTS --numberOfGCMarkers=1" ;;
  esac > "$out" 2>&1
  python3 "$H/summ.py" "$out"
}
for r in $(seq 1 "$rounds"); do
  for p in $pages; do
    order=("${engines[@]}")
    [ $((r % 2)) = 0 ] && mapfile -t order < <(printf '%s\n' "${engines[@]}" | tac)
    for e in "${order[@]}"; do run "$e" "$p" "$r"; done
  done
done

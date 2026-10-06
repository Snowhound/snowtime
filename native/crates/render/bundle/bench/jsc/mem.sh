#!/bin/bash
# mem.sh: where Bun's and the jsc shell's memory goes, on the timer and year pages.
# RSS split into anonymous and file-backed at the end of the measured loop, GC counts and
# pauses from logGC, and on the timer the resident memory by mapping kind (smaps.py).
# Raw output goes to $OUT/raw-mem/. Stop other containers first.
source "$(dirname "$0")/env.sh"
mkdir -p "$OUT/raw-mem"
# bun-bench, plus /proc/self/status and smaps at the end
sed 's|^console.log($|console.log("STATUS " + readFileSync("/proc/self/status", "utf8").match(/^(VmHWM\|VmRSS\|RssAnon\|RssFile):.*$/gm).join(" ").replace(/\s+/g, " "))\nif (process.env.RUN_JSC_SMAPS) writeFileSync(process.env.RUN_JSC_SMAPS, readFileSync("/proc/self/smaps", "utf8"))\nconsole.log(|' \
  "$B/bun-bench.ts" > "$B/bun-bench-mem.ts"
bun() { # page logGC [smaps file]
  docker run --rm --cpus=1 --memory=2g -v "$RESULTS:/results:ro" -v "$B:/b" -v "$OUT:/o" -w /b \
    -e BUN_JSC_logGC=$2 -e RUN_JSC_SMAPS=$3 -e BUN_RENDER_BUNDLE=/b/dist/render.phase.js \
    oven/bun:1.4.2 bun bun-bench-mem.ts /results/$1.json /results/answers.json 500
}
for p in timer year; do
  for gc in 0 1; do
    smaps=; [ $p = timer ] && [ $gc = 0 ] && smaps=1
    bun $p $gc ${smaps:+/o/raw-mem/smaps-bun-$p.txt} > "$OUT/raw-mem/bun-gc$gc-$p.txt" 2>&1
    RUN_JSC_SMAPS=${smaps:+/o/raw-mem/smaps-jsc-$p.txt} "$H/jrun.sh" $p 500 "--logGC=$gc" \
      > "$OUT/raw-mem/jsc-gc$gc-$p.txt" 2>&1
    RUN_JSC_SMAPS=${smaps:+/o/raw-mem/smaps-jsc-noftl-$p.txt} "$H/jrun.sh" $p 500 \
      "--logGC=$gc --useFTLJIT=0" > "$OUT/raw-mem/jsc-noftl-gc$gc-$p.txt" 2>&1
  done
done
rm "$B/bun-bench-mem.ts"
for f in "$OUT"/raw-mem/*-gc0-*.txt; do echo "$(basename "$f"): $(grep STATUS "$f")"; done
python3 "$H/gclog.py" "$OUT"/raw-mem/*-gc1-*.txt
for f in bun jsc jsc-noftl; do echo "$f"; python3 "$H/smaps.py" "$OUT/raw-mem/smaps-$f-timer.txt"; done

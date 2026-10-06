#!/bin/bash
set -eu
cd "$(dirname "$0")/../../../.."
image=${1:-snowtime-render:api-bench}
folder=${2:-allocation}
mkdir -p "native/crates/render/results/$folder"
for page in timer week month year; do
 for engine in v8 bun; do
  docker run --rm --cpus=1 --memory=2g --cap-add PERFMON --cap-add SYS_PTRACE --security-opt seccomp=unconfined -v "$PWD:/work" -w /tmp -e RENDER_PERF_CONTROL=/tmp/control -e RENDER_PERF_ACK=/tmp/ack -e RENDER_PERF_PROF=1 -e FOLDER="$folder" -e PAGE="$page" -e ENGINE="$engine" "$image" bash -c '
set -eu
out=/work/native/crates/render/results/$FOLDER
mkfifo /tmp/control /tmp/ack
if [ "$ENGINE" = v8 ]; then
 cmd=(render-bench /work/native/crates/render/results/$PAGE.json /work/native/crates/render/results/answers.json 500 1 1)
else
 cmd=(bun /work/native/crates/render/bundle/bun-bench.ts /work/native/crates/render/results/$PAGE.json /work/native/crates/render/results/answers.json 500)
fi
perf record -D -1 --control=fifo:/tmp/control,/tmp/ack -k 1 -e cpu-clock -F 99 -g --call-graph dwarf -o "$out/$PAGE-$ENGINE.perf.data" -- "${cmd[@]}" > "$out/$PAGE-$ENGINE-perf.json" 2> "$out/$PAGE-$ENGINE-perf.log"
if [ "$ENGINE" = v8 ]; then
 perf inject --jit -i "$out/$PAGE-$ENGINE.perf.data" -o "$out/$PAGE-$ENGINE.jit.data"
 cp jit-*.dump "$out/$PAGE-jit.dump"
 data="$out/$PAGE-$ENGINE.jit.data"
else
 data="$out/$PAGE-$ENGINE.perf.data"
fi
perf report -i "$data" --stdio --no-children --percent-limit 0 --sort comm,symbol > "$out/$PAGE-$ENGINE-perf.txt"
perf script -i "$data" -F comm,pid,tid,time,event,ip,sym,dso > "$out/$PAGE-$ENGINE-stacks.txt"
'
 done
done

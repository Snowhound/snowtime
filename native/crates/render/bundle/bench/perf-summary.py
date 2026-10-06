"""Summarize conservative named self-symbol groups from perf script and report."""
import collections
import json
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text()
buckets = collections.defaultdict(float)
threads = collections.defaultdict(float)
symbols = []
stacks = Path(sys.argv[2]).read_text()
samples = []
thread = None
for line in stacks.splitlines():
    header = re.match(r"(.*?)\s+\d+/\d+\s+[\d.]+:\s+cpu-clock:", line)
    if header:
        thread = header[1].strip()
        continue
    frame = re.match(r"\s+[0-9a-f]+\s+(.*)\s+\(([^()]*)\)\s*$", line)
    if thread is not None and frame:
        samples.append((thread, frame[1], frame[2]))
        thread = None
for thread, symbol, dso in samples:
    weight = 100 / len(samples)
    mode = "k" if "kernel" in dso else "."
    if mode == "k" or re.match(r"0x[0-9a-f]+$", symbol) or symbol == "[unknown]":
        bucket = "unresolved"
    elif re.search(r"MarkCompact|ConcurrentMarking|Scaveng|Sweeper|Sweep|GarbageCollect|CollectGarbage|MinorMark|Evacuat|MarkingVisitor|MarkingWorklist|RememberedSet|Ephemeron|WeakObjects|GCTracer", symbol):
        bucket = "GC named self symbols"
    elif re.search(r"v8::internal::(?:compiler::|maglev::|.*(?:Compiler|Compilation|CompileJob|CompilationJob|Parser|Scanner::|CodeGenerator))", symbol):
        bucket = "compiler named self symbols"
    elif re.search(r"icu_|icu::|DateTimeFormat|Intl", symbol):
        bucket = "ICU/Intl named self symbols"
    elif re.search(r"simdutf|Utf8|UTF8|String::Write|String::Flatten|String::SlowFlatten", symbol):
        bucket = "string/encoding named self symbols"
    elif re.search(r"Builtin:|LazyCompile:|Function:|Script:|JS:", symbol):
        bucket = "JIT code/builtins"
    elif "v8::" in symbol:
        bucket = "other V8 runtime"
    else:
        bucket = "other named native"
    buckets[bucket] += weight
    threads[thread] += weight
    symbols.append({"percent": weight, "thread": thread, "symbol": symbol})
grouped = collections.defaultdict(float)
for item in symbols:
    grouped[(item["thread"], item["symbol"])] += item["percent"]
symbols = [{"thread": thread, "symbol": symbol, "percent": weight}
           for (thread, symbol), weight in grouped.items()]
print(json.dumps({
    "report": sys.argv[1],
    "method": "99 Hz cpu-clock; all inherited process threads; measured loop only; conservative named self symbols; counted first stack frames",
    "samples": int(re.search(r"# Samples: (\d+)", text)[1]),
    "classified_samples": len(samples),
    "lost_samples": int(re.search(r"# Total Lost Samples: (\d+)", text)[1]),
    "accounted_percent": sum(buckets.values()),
    "buckets_percent": dict(buckets),
    "threads_percent": dict(threads),
    "top_symbols": sorted(symbols, key=lambda s: -s["percent"])[:30],
}, indent=2))

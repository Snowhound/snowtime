#!/usr/bin/env python3
"""Summarize the three alternating prototype-props rounds."""
import hashlib
import json
from pathlib import Path
from statistics import mean
root = Path(__file__).resolve().parents[4]
results = root/'native/crates/render/results/prototype'
rows = []
groups = {}
for page in ('timer', 'week', 'month', 'year'):
    for engine in ('v8-default', 'v8-32', 'bun'):
        for variant in ('plain', 'prototype'):
            values = []
            for round_number in (1, 2, 3):
                path = results/'raw'/f'{page}-{engine}-{variant}-{round_number}.json'
                data = json.loads(path.read_text())
                row = {'fixture': page, 'configuration': engine, 'variant': variant,
                       'round': round_number, **data}
                rows.append(row)
                values.append(data)
            groups[page, engine, variant] = values
metadata = {
    'kind': 'metadata', 'base': '3392ee2', 'cpus': 1, 'memory_bytes': 2 << 30,
    'warmups': 50, 'count': 500, 'rounds': 3,
    'order': ['plain,prototype', 'prototype,plain', 'plain,prototype'],
    'bundles': {
        variant: hashlib.sha256((results/f'render.measured.{variant}.js').read_bytes()).hexdigest()
        for variant in ('plain', 'prototype')
    },
}
out = root/'tasks/081-native-backend/server-rendering/prototype-props-wsl.jsonl'
out.write_text('\n'.join(json.dumps(r, separators=(',', ':')) for r in [metadata, *rows])+'\n')
print('| Engine / semi-space | Page | CPU ms, plain → prototype | Render thread | V8 workers | p95 ms | Peak RSS MB | CPU change |')
print('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
for engine in ('v8-default', 'v8-32', 'bun'):
    for page in ('timer', 'week', 'month', 'year'):
        metrics = []
        for variant in ('plain', 'prototype'):
            runs = groups[page, engine, variant]
            metrics.append({
                'cpu': mean(r['cpu_ms'] for r in runs),
                'p95': mean(r['p95_ms'] for r in runs),
                'rss': mean(r['peak_rss_mb'] for r in runs),
                'thread': mean(sum(v for k, v in r.get('thread_cpu_ms', {}).items()
                                   if k.startswith('snowtime-render:')) for r in runs),
                'workers': mean(sum(v for k, v in r.get('thread_cpu_ms', {}).items()
                                    if k.startswith('V8 ')) for r in runs),
            })
        a, b = metrics
        def pair(key, precision=2):
            return f"{a[key]:.{precision}f} → {b[key]:.{precision}f}"
        thread = pair('thread') if engine.startswith('v8') else '—'
        workers = pair('workers') if engine.startswith('v8') else '—'
        print(f"| {engine} | {page} | {pair('cpu')} | {thread} | {workers} | {pair('p95')} | {pair('rss', 0)} | {(b['cpu']/a['cpu']-1)*100:+.1f}% |")

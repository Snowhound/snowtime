#!/usr/bin/env python3
"""Summarize props-measure.sh's three alternating rounds of the props bundles."""
import hashlib
import json
import sys
from pathlib import Path
from statistics import mean
root = Path(__file__).resolve().parents[4]
results = root/'native/crates/render/results/props'
variants = ('plain', 'prototype', 'shared')
out = root/'tasks/081-native-backend/server-rendering'/(sys.argv[1] if len(sys.argv) > 1 else 'shared-props-mac.jsonl')
rows = []
groups = {}
for page in ('timer', 'week', 'month', 'year'):
    for engine in ('v8-default', 'v8-32', 'bun'):
        for variant in variants:
            values = []
            for round_number in (1, 2, 3):
                data = json.loads((results/'raw'/f'{page}-{engine}-{variant}-{round_number}.json').read_text())
                rows.append({'fixture': page, 'configuration': engine, 'variant': variant,
                             'round': round_number, **data})
                values.append(data)
            groups[page, engine, variant] = values
metadata = {
    'kind': 'metadata', 'cpus': 1, 'memory_bytes': 2 << 30, 'warmups': 50, 'count': 500, 'rounds': 3,
    'order': [','.join(variants), ','.join(reversed(variants)), ','.join(variants)],
    'bundles': {v: hashlib.sha256((results/f'render.measured.{v}.js').read_bytes()).hexdigest() for v in variants},
}
out.write_text('\n'.join(json.dumps(r, separators=(',', ':')) for r in [metadata, *rows])+'\n')


def metrics(runs):
    def threads(r, prefix):
        return sum(v for k, v in r.get('thread_cpu_ms', {}).items() if k.startswith(prefix))
    return {'cpu': mean(r['cpu_ms'] for r in runs), 'p95': mean(r['p95_ms'] for r in runs),
            'rss': mean(r['peak_rss_mb'] for r in runs),
            'thread': mean(threads(r, 'snowtime-render:') for r in runs),
            'workers': mean(threads(r, 'V8 ') for r in runs)}


print('| Engine / semi-space | Page | CPU ms, plain → prototype → shared | Render thread | V8 workers | p95 ms | Peak RSS MB | Prototype | Shared |')
print('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
for engine in ('v8-default', 'v8-32', 'bun'):
    for page in ('timer', 'week', 'month', 'year'):
        m = [metrics(groups[page, engine, v]) for v in variants]
        def chain(key, precision=2):
            return ' → '.join(f'{x[key]:.{precision}f}' for x in m)
        v8 = engine.startswith('v8')
        print(f"| {engine} | {page} | {chain('cpu')} | {chain('thread') if v8 else '—'} | "
              f"{chain('workers') if v8 else '—'} | {chain('p95')} | {chain('rss', 0)} | "
              f"{(m[1]['cpu']/m[0]['cpu']-1)*100:+.1f}% | {(m[2]['cpu']/m[0]['cpu']-1)*100:+.1f}% |")

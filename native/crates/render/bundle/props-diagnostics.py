#!/usr/bin/env python3
"""Summarize getter creation, post-render promotion, and GC traces."""
import json
from pathlib import Path
from statistics import mean
root = Path(__file__).resolve().parents[4]
diag = root/'native/crates/render/results/props/diagnostic'
rows = []
groups = {}
VARIANTS = ('plain', 'prototype', 'shared')
for page in ('timer', 'week', 'month', 'year'):
    for variant in VARIANTS:
        lines = (diag/f'{page}-{variant}-counts.txt').read_text().splitlines()
        counts = [json.loads(l.removeprefix('PROPS_COUNTS ')) for l in lines if l.startswith('PROPS_COUNTS ')]
        assert len(counts) == 1
        rows.append({'kind': 'getters', 'fixture': page, 'variant': variant, **counts[0]})
        lines = (diag/f'{page}-{variant}-gc.txt').read_text().splitlines()
        samples = [json.loads(l.removeprefix('PROPS_GC ')) for l in lines if l.startswith('PROPS_GC ')]
        assert len(samples) == 72
        # One initial page, 50 warm-ups, 20 measured pages, then the profiler finish page.
        measured = samples[51:71]
        assert all('oldPreMinor' in s for s in measured)
        groups[page, variant] = measured
        for index, sample in enumerate(measured, 52):
            rows.append({'kind': 'gc-probe', 'fixture': page, 'variant': variant, 'render': index, **sample})
        for semi in ('default', '32'):
            text = (diag/f'{page}-{semi}-{variant}-trace.txt').read_text()
            rows.append({'kind': 'gc-trace', 'fixture': page, 'variant': variant,
                         'semi_space': semi, 'renders': 551,
                         'scavenges': text.count(' Scavenge '),
                         'mark_compacts': text.count(' Mark-Compact ')})
out = root/'tasks/081-native-backend/server-rendering/shared-props-mac-diagnostics.jsonl'
out.write_text('\n'.join(json.dumps(r, separators=(',', ':')) for r in rows)+'\n')
print('| Page | defineProperty getters | Fresh defineProperty getters | defineProperties getters | Getter literals evaluated | Literal getters created |')
print('| --- | ---: | ---: | ---: | ---: | ---: |')
for page in ('timer', 'week', 'month', 'year'):
    counts = [{**r} for r in rows if r['kind']=='getters' and r['fixture']==page]
    def chain(key):
        return ' → '.join(f'{c[key]:,}' for c in counts)
    print(f"| {page} | {chain('definePropertyGetters')} | {chain('freshDefinePropertyGetters')} | {chain('definePropertiesGetters')} | {chain('literalObjects')} | {chain('literalGetters')} |")
print('\n| Page | Promoted after first minor, MiB | Promoted after two minors, MiB | Heap increase after first minor, MiB | Retained after full, KiB |')
print('| --- | ---: | ---: | ---: | ---: |')
for page in ('timer', 'week', 'month', 'year'):
    values = []
    for variant in VARIANTS:
        samples = groups[page, variant]
        values.append([
            mean(s['firstOld']-s['oldPreMinor'] for s in samples)/(1<<20),
            mean(s['secondOld']-s['oldPreMinor'] for s in samples)/(1<<20),
            mean(s['firstHeap']-s['heapBefore'] for s in samples)/(1<<20),
            mean(s['liveHeap']-s['heapBefore'] for s in samples)/(1<<10),
        ])
    print('| '+page+' | '+' | '.join(' → '.join(f'{x:.2f}' for x in column) for column in zip(*values))+' |')
print('\n| Semi-space | Page | Scavenges | Mark-compacts |')
print('| --- | --- | ---: | ---: |')
for semi in ('default', '32'):
    for page in ('timer', 'week', 'month', 'year'):
        traces = [r for r in rows if r['kind']=='gc-trace' and r['fixture']==page and r['semi_space']==semi]
        print(f"| {semi} | {page} | {' → '.join(str(t['scavenges']) for t in traces)} | {' → '.join(str(t['mark_compacts']) for t in traces)} |")

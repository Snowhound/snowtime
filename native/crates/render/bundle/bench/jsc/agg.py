# agg.py <raw dir>: medians over the gate rounds per engine and page, with B relative to Bun.
import glob, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from summ import parse
rows = [parse(p) for p in glob.glob(sys.argv[1] + '/*.txt')]
rows = [r for r in rows if not r.get('error')]
pages = ['timer', 'week', 'month', 'year']
engines = ['v8', 'bun', 'jsc', 'jsc-bunopts', 'jsc-plain', 'jsc-bunsrc', 'jsc-noftl', 'jsc-nodfg', 'jsc-1marker']
med = {}
for e in engines:
    for p in pages:
        rs = [r for r in rows if r['engine'] == e and r['page'] == p]
        if rs:
            med[e, p] = {k: statistics.median(r[k] for r in rs) for k in ('cpu', 'p50', 'p95', 'rss', 'A', 'B', 'C')}
            med[e, p]['n'] = len(rs)
print('| Page | Engine | Runs | CPU | p50 | p95 | Peak RSS | A | B | C | B vs Bun |')
print('| --- | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: |')
for p in pages:
    for e in engines:
        m = med.get((e, p))
        if not m: continue
        rel = (m['B'] / med['bun', p]['B'] - 1) * 100
        print('| %s | %s | %d | %.2f | %.2f | %.2f | %.0f | %.2f | %.2f | %.2f | %+.0f%% |' % (
            p, e, m['n'], m['cpu'], m['p50'], m['p95'], m['rss'], m['A'], m['B'], m['C'], rel))

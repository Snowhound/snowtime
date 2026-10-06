# summ.py <raw files...>: one line per run with CPU, latency, RSS, and phases A/B/C
# (wall ms per render over renders 100-500, from the bundle's PHASES lines).
import json, os, sys

def parse(path):
    phases, result = [], None
    for line in open(path, errors='replace'):
        if 'PHASES ' in line:
            phases.append(json.loads(line.split('PHASES ', 1)[1]))
        elif line.startswith('{"'):
            result = json.loads(line)
    name = os.path.basename(path)[:-4]
    engine, page, rnd = name.rsplit('-', 2)
    row = {'engine': engine, 'page': page, 'round': int(rnd)}
    if result is None or len(phases) < 2:
        row['error'] = True
        return row
    a, b = phases[0], phases[1]
    n = b['n'] - a['n']
    A = (b['a'] - a['a']) / n
    B = (b['b'] - a['b']) / n
    T = (b['total'] - a['total']) / n
    row.update(A=A, B=B, C=T - A - B, total=T, cpu=result['cpu_ms'], p50=result['p50_ms'],
               p95=result['p95_ms'], rss=result['peak_rss_mb'],
               main=result.get('main_thread_cpu_ms'), startup=result.get('startup_ms'))
    return row

if __name__ == '__main__':
    for path in sys.argv[1:]:
        r = parse(path)
        if r.get('error'):
            print('%-12s %-6s r%d ERROR (see %s)' % (r['engine'], r['page'], r['round'], path))
            continue
        print('%-12s %-6s r%d cpu=%6.2f p50=%6.2f p95=%6.2f rss=%5.0f  A=%5.2f B=%6.2f C=%5.2f total=%6.2f%s' % (
            r['engine'], r['page'], r['round'], r['cpu'], r['p50'], r['p95'], r['rss'],
            r['A'], r['B'], r['C'], r['total'],
            '  main=%.2f' % r['main'] if r['main'] is not None else ''))

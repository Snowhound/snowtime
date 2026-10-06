# gclog.py <logGC outputs...>: per run, eden and full collections, their summed main-thread
# pause (p=), the budget that started them, and the heap size after full collections.
import re, sys
for path in sys.argv[1:]:
    text = open(path, errors='replace').read()
    kinds = re.findall(r'START M \d+kb => (\w+)Collection', text)
    pauses = [float(x) for x in re.findall(r'p=([\d.]+)ms \(max', text)]
    ends = re.findall(r'=> (\d+)kb, p=[\d.]+ms \(max [\d.]+\), cycle ([\d.]+)ms END', text)
    allowed = re.findall(r'bytes allowed: (\d+)', text)
    after = [int(k) for k, _ in ends]
    print('%-28s eden=%4d full=%3d pause_sum=%7.1fms cycle_sum=%7.0fms budget=%sMB heap_after max=%dMB median=%dMB' % (
        path.split('/')[-1], kinds.count('Eden'), kinds.count('Full'), sum(pauses),
        sum(float(c) for _, c in ends), sorted(set(int(a) >> 20 for a in allowed))[:4],
        max(after) >> 10 if after else 0, sorted(after)[len(after) // 2] >> 10 if after else 0))

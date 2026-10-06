# smaps.py <smaps file>: resident memory grouped by mapping kind.
import re, sys

groups = {}
cur = None
for line in open(sys.argv[1]):
    m = re.match(r'^([0-9a-f]+)-([0-9a-f]+) (\S+) \S+ \S+ \d+\s*(.*)$', line)
    if m:
        size = (int(m.group(2), 16) - int(m.group(1), 16)) >> 20
        perms, name = m.group(3), m.group(4).strip()
        if name.startswith('/'):
            cur = 'file'
        elif name:
            cur = name
        elif 'x' in perms:
            cur = 'anon exec (JIT code)'
        elif size >= 64:
            cur = 'anon >= 64 MB mappings (GC heap, allocator)'
        else:
            cur = 'anon < 64 MB (malloc, stacks, misc)'
        continue
    m = re.match(r'^Rss:\s+(\d+) kB', line)
    if m and cur:
        groups[cur] = groups.get(cur, 0) + int(m.group(1))
for k, v in sorted(groups.items(), key=lambda x: -x[1]):
    print('  %-46s %6.1f MB' % (k, v / 1024))

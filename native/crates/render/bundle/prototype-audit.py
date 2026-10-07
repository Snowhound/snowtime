#!/usr/bin/env python3
"""Attribute the complete read inventory through the plain bundle's source map."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[4]
d=root/'native/crates/render/bundle/dist'
code=(d/'render.js').read_text().splitlines()
smap=json.loads((d/'render.js.map').read_text())
chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
def vlqs(encoded):
    v=shift=0
    for c in encoded:
        n=chars.index(c)
        v|=(n&31)<<shift
        if n&32: shift+=5
        else:
            yield -(v>>1) if v&1 else v>>1
            v=shift=0
source=line=column=0
locations={}
for generated,encoded in enumerate(smap['mappings'].split(';'),1):
    gen_column=0
    parts=[]
    for segment in encoded.split(','):
        fields=list(vlqs(segment))
        if not fields: continue
        gen_column+=fields[0]
        if len(fields)>=4:
            source+=fields[1]; line+=fields[2]; column+=fields[3]
            parts.append((gen_column,source,line+1,column))
    locations[generated]=parts
audit=json.loads((d/'prototype-audit.json').read_text())
text=(d/'render.js').read_text()
merge_start=text[:text.index('function mergeProps(')].count('\n')+1
split_end=text[:text.index('function simpleMap(')].count('\n')
for row in audit['reads']:
    gen_column=code[row['line']-1].find(row['expression'].split('\n')[0])
    mappings=locations[row['line']]
    before=[m for m in mappings if m[0]<=gen_column]
    mapping=before[-1] if before else (mappings[0] if mappings else None)
    if mapping:
        row['source']=smap['sources'][mapping[1]]
        while row['source'].startswith('../'): row['source']=row['source'][3:]
        row['source_line']=mapping[2]
    else: row['source']='bundle'
    if 'rest' in row['kind']:
        row['handling']='Own-descriptor bridge for branded props preserves named-getter order; ordinary inputs pass through'
    if row['source']=='node_modules/solid-js/dist/server.js' and merge_start <= row['line'] <= split_end:
        row['handling']='The mergeProps/splitProps body is replaced by the cached prototype adapter'
out=root/'tasks/081-native-backend/server-rendering/prototype-props-audit.jsonl'
out.write_text('\n'.join(json.dumps(r,separators=(',',':')) for r in audit['reads'])+'\n')
from collections import Counter
print(Counter(r['source'] for r in audit['reads'] if 'kobalte' in r['source'] or 'meta' in r['source'] or 'solid-router' in r['source']))

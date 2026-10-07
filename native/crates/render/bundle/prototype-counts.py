#!/usr/bin/env python3
"""Instrument getter construction in saved server bundles, outside timing runs."""
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parents[4]
out = root/'native/crates/render/results/prototype/diagnostic'
out.mkdir(parents=True, exist_ok=True)
instrument = r"""
import {parse} from 'acorn';
import {readFileSync,writeFileSync} from 'node:fs';
const [input,output]=process.argv.slice(2);
const code=readFileSync(input,'utf8'), edits=[];
function walk(n) {
 if (!n || typeof n.type!=='string') return;
 if (n.type==='ObjectExpression') {
  const getters=n.properties.filter(p=>p.kind==='get').length;
  if (getters) {
   edits.push([n.start,n.start,'(propsCounts.literalObjects++,propsCounts.literalGetters+='+getters+',']);
   edits.push([n.end,n.end,')']);
  }
 }
 for (const v of Object.values(n)) {
  if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v==='object' && v.type) walk(v);
 }
}
walk(parse(code,{ecmaVersion:'latest',sourceType:'script'}));
let s=code;
for(const [start,end,text] of edits.sort((a,b)=>b[0]-a[0]||b[1]-a[1])) s=s.slice(0,start)+text+s.slice(end);
const before=String.raw\`
var propsCounts={definePropertyGetters:0,definePropertiesGetters:0,literalObjects:0,literalGetters:0};
{
 const one=Object.defineProperty, many=Object.defineProperties;
 Object.defineProperty=function(o,k,d){if(typeof d.get==='function') propsCounts.definePropertyGetters++;return one(o,k,d)};
 Object.defineProperties=function(o,ds){for(const d of Object.values(ds)) if(typeof d.get==='function') propsCounts.definePropertiesGetters++;return many(o,ds)};
}
\`;
const after=String.raw\`
{
 const render=globalThis.renderPage;
 let pages=0;
 globalThis.renderPage=async function(page) {
  await render(page);
  if (++pages===59) for(const k of Object.keys(propsCounts)) propsCounts[k]=0;
  if (pages===60) console.log('PROPS_COUNTS '+JSON.stringify(propsCounts));
 };
}
\`;
writeFileSync(output,before+s+after);
"""
instrument = instrument.replace(chr(92)+chr(96), chr(96))
script = out/'instrument-counts.mjs'
script.write_text(instrument)
for variant in ('plain','prototype'):
    bundle = root/'native/crates/render/bundle/dist'/('render.js' if variant=='plain' else 'render.prototype.js')
    counted = out/f'counted-{variant}.js'
    subprocess.run(['bun',str(script),str(bundle),str(counted)],check=True,cwd=root)
    for page in ('timer','week','month','year'):
        args=['docker','run','--rm','--cpus=1','--memory=2g',
              '-e',f'BUN_RENDER_BUNDLE=/work/{counted.relative_to(root)}',
              '-v',f'{root}:/work:ro','-w','/work','oven/bun:1.4.2',
              'bun','native/crates/render/bundle/bun-bench.ts',
              f'native/crates/render/results/{page}.json',
              'native/crates/render/results/answers.json','9']
        with (out/f'{page}-{variant}-counts.txt').open('w') as f:
            subprocess.run(args,check=True,stdout=f,stderr=subprocess.STDOUT)

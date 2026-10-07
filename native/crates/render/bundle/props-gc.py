#!/usr/bin/env python3
"""Prepare a diagnostic image context without changing the render pool."""
from pathlib import Path
import shutil
root=Path(__file__).resolve().parents[4]
import tempfile
out=Path(tempfile.mkdtemp(prefix='snowtime-props-diagnostic-'))
print(out)
out.mkdir(exist_ok=True)
# Copy only render build inputs; do not copy ignored captures or target directories.
for p in (root/'native').rglob('*'):
    rel=p.relative_to(root)
    if any(x in ('target','results','.git','node_modules') for x in rel.parts): continue
    if p.is_file():
        dest=out/rel
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(p,dest)
render=out/'native/crates/render'
shutil.copyfile(root/'native/crates/render/bundle/bench/props-gc.rs',render/'src/gc-probe.rs')
p=render/'src/extensions.rs'
s=p.read_text().replace('pub fn extensions()', '#[path = "gc-probe.rs"]\nmod gc_probe;\n\npub fn extensions()').replace('        encoding::encoding_ops::init(),','        encoding::encoding_ops::init(),\n        gc_probe::props_gc_ops::init(),')
p.write_text(s)

p=render/'src/profile.rs'
s=p.read_text()
anchor='        let session = JsRuntimeInspector::create_local_session('
assert s.count(anchor)==1
s=s.replace(anchor,"        let probe_before = Rc::new(RefCell::new(None::<serde_json::Value>));\n"+anchor)
anchor='                // Keep deep allocation trees as raw JSON instead of parsing and cloning them.'
assert s.count(anchor)==1
s=s.replace(anchor,r"""
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&message.content) {
                    let id = value.get("id").and_then(|id| id.as_i64());
                    if id == Some(61) {
                        *probe_before.borrow_mut() = value.pointer("/result/result/value").cloned();
                        return;
                    }
                    if id == Some(62) {
                        if let Some(mut data) = value.pointer("/result/result/value").cloned()
                            && let Some(before) = probe_before.borrow().as_ref()
                        {
                            data["oldBefore"] = before[2].clone();
                            data["heapBefore"] = before[3].clone();
                            eprintln!("PROPS_GC {data}");
                        }
                        return;
                    }
                }
"""+anchor)
anchor='    pub(crate) fn before(&mut self) {'
assert s.count(anchor)==1
s=s.replace(anchor,anchor+r"""
        if std::env::var_os("RENDER_GC_PROBE").is_some() {
            self.session.post_message(61, "Runtime.evaluate",
                Some(serde_json::json!({"expression":"Deno.core.ops.op_props_gc(true)", "returnByValue":true})));
            return;
        }
""")
anchor='    pub(crate) fn after(&mut self) {'
assert s.count(anchor)==1
s=s.replace(anchor,anchor+r"""
        if std::env::var_os("RENDER_GC_PROBE").is_some() {
            self.session.post_message(62, "Runtime.evaluate",
                Some(serde_json::json!({"expression":
                    "(() => { const [oldPreMinor,heapPreMinor,firstOld,firstHeap]=Deno.core.ops.op_props_gc(false); const [,,secondOld,secondHeap]=Deno.core.ops.op_props_gc(false); const [,,liveOld,liveHeap]=Deno.core.ops.op_props_gc(true); return {oldPreMinor,heapPreMinor,firstOld,firstHeap,secondOld,secondHeap,liveOld,liveHeap}; })()",
                    "returnByValue":true})));
            self.renders += 1;
            return;
        }
""")
p.write_text(s)
# Keep the shared pool file byte-identical even in this build context.
assert (render/'src/lib.rs').read_bytes()==(root/'native/crates/render/src/lib.rs').read_bytes()

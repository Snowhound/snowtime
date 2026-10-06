# 081.14: Render garbage that dies young

Status: done (promotion identified but not removed; 32 MiB semi-space chosen by the host)

[The engine-gap report](server-rendering/engine-gap-wsl.md) found that V8's background GC
costs 3.9–4.4 ms per render, about 2 ms of the gap to Bun. Each render promotes 1.3–2.5 MB
of objects that are already dead. A full mark-compact therefore runs every ~5 renders.
The heap policy also turns a larger nursery into a full GC after every page. This task
fixes both, then tunes the nursery.

Measure as task 081.13 does: one CPU, 2 GiB, three alternating rounds per page, with
byte-identical HTML. Use `render-bench`'s `thread_cpu_ms` and `V8_FLAGS`, and the scripts
in the report's "Reproduction" section.

## Result

[The WSL report](server-rendering/render-gc-wsl.md) records the measurements. V8 promotes
dead render objects because its scavenger treats two kinds of old-space reference as
roots: the `AccessorPair`s behind Solid's getter props, which V8 always allocates in old
space, and WeakMap values. Removing most accessors through Proxies lowers promotion by
only 15–20% and costs CPU, so it isn't shipped. `Renderer::collect` now reads the old
generation, and the host gives each renderer a 32 or 16 MiB semi-space where memory
allows. On one renderer a 32 MiB semi-space lowers V8's CPU by 9–11% (to 1.50–1.63 times
Bun's) for 30–41 MB of peak RSS. A post-render minor GC and the remaining flags are
rejected.

## Acceptance criteria

- [x] The old-space objects that keep dead young objects alive across a scavenge
      identified, by heap-snapshot diffs or by removing caches and globals one at a time,
      and the promotion per render after a post-render minor GC recorded before and after
      the fix
- [x] Solid's `sharedConfig.context`, and any other per-render global the bundle leaves
      set, cleared when `renderPage` finishes
- [x] `Renderer::collect` and the replace check driven by old-generation size, not
      `used_heap_size`, so the young generation no longer triggers
      `low_memory_notification`
- [x] A semi-space sweep (4, 8, 16, and 32 MB) at one renderer and at the host's renderer
      count, under the host's total memory budget, with CPU, p95, and RSS per page; the
      chosen size set by the host and recorded with its reason
- [x] A post-render minor GC kept only if it wins CPU on all four pages
- [x] One sweep of the remaining GC flags (`--scavenger-max-new-space-capacity-mb`,
      pinning, page promotion thresholds) after the fixes above; flags kept only with a
      consistent whole-render win
- [x] The remaining CPU gap to Bun, and the worker share of V8's CPU, recorded in the
      report

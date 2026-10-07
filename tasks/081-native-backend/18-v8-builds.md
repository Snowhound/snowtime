# 081.18: Newer V8 builds against the render gap

Status: todo

Task 081.14 traced most of V8's GC cost to two scavenger behaviours: it treats the
`AccessorPair`s behind Solid's getter props as roots, because V8 allocates them in old
space, and it treats WeakMap values as strong
([report](server-rendering/render-gc-wsl.md)). The engine-gap report adds slow creation of
getter literals, which stay in dictionary mode. All of this was measured on one V8, the
`v8` 149.4 crate that `deno_core` pins. Find out whether newer V8 builds, flags, or
build-time options do better, before spending more on workarounds in the bundle.

A win counts only when `rusty_v8` can ship it, so record for each candidate which
`rusty_v8` release would carry it, or whether it needs a custom build.

## Benchmarks

Build the cheapest benchmark first, and the real bundle last:

1. Microbenchmarks that print one number per engine in seconds. `acc.mjs` and `wm.mjs`
   measure promotion through accessors and WeakMaps; `lit.mjs` and `props-micro.mjs`
   measure getter creation. They are in the ignored `native/crates/render/results/gc/`
   and `results/engine-gap/` of `/root/snowtime-gc` on the WSL machine; commit them under
   `native/crates/render/bundle/bench/v8/`.
2. A synthetic Solid server render: a component tree with getter props, `mergeProps` and
   `splitProps`, and string building, allocating about 8 MB per page like the timer. It
   reports CPU per page, scavenges and mark-compacts per page (`--trace-gc`), and
   promotion after a forced minor GC (`--expose-gc`). Check that it reproduces the
   ranking of task 081.14's bundle variants before trusting it.
3. The real bundle on Node with `node-bench.ts` from the engine-gap report, against this
   task's captures, one CPU and 2 GiB, three alternating rounds per page.

## Engines

- d8 from `jsvu`: current stable, beta, and canary, plus JavaScriptCore as the reference
  for getter creation.
- Node 24, the latest Node release, and Node's `v8-canary` nightly
  (`nodejs.org/download/v8-canary`) for the real bundle.
- The render crate on the newest `rusty_v8` release that `deno_core` accepts, if it is
  newer than 149.4.

## Acceptance criteria

- [ ] The microbenchmarks and the synthetic render committed, with the synthetic render
      shown to rank task 081.14's bundle variants as the real bundle does
- [ ] Promotion, scavenges and mark-compacts per page, and getter-creation time recorded
      for each engine build above
- [ ] V8 changes since 149.4 that touch accessor allocation, weak references in the
      scavenger, MinorMS, or dictionary-mode properties listed with links, and the
      `rusty_v8` release that carries each
- [ ] MinorMS (`--minor-ms`) and any new young-generation flags re-measured on the newest
      build; build-time options such as `v8_enable_sticky_mark_bits` assessed from source
      and, if promising, measured with a custom `rusty_v8` build
- [ ] For each win: the real bundle's CPU, p95, and peak RSS on four pages against
      task 081.14's baseline, and the earliest `rusty_v8` release that ships it
- [ ] A recommendation recorded: upgrade `deno_core`/`rusty_v8`, build V8 ourselves, wait
      for a named release, or stop and rely on the Bun sidecar

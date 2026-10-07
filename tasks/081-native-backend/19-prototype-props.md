# 081.19: Server props without per-render getters

Status: todo

Solid 1's server output creates props objects whose getters are fresh closures on every
render: compiled `createComponent(C, { get a() { … } })` sites, and getters that
`mergeProps` and `splitProps` define per key. V8 creates such objects through runtime
calls in dictionary mode, and allocates each getter's `AccessorPair` in old space, where
its scavenger treats it as a root until the next mark-compact. That promotes most of each
page's dead objects ([task 081.14's report](server-rendering/render-gc-wsl.md),
[engine-gap report](server-rendering/engine-gap-wsl.md)).

Solid 2.0 fixes this from rc.10 (2026-09-23): the SSR compiler hoists each props literal
with getters into a constructor whose getters live on a shared prototype
([solid#3511](https://github.com/solidjs/solid/issues/3511),
[next-yak#657](https://github.com/DigitecGalaxus/next-yak/issues/657)). Migrating the app
to Solid 2.0 is a separate, larger job: Kobalte's support is unknown, and TanStack's is
in beta. This task backports the idea to Solid 1's server bundle as a build-time
rewrite, behind a flag.

A microbenchmark of 1M three-prop objects (`results/gc/scripts/shapes.mjs` in
`/root/snowtime-gc` on the WSL machine) motivates it:

| Layout                 | Node 24 create | Promoted, 2,000 dropped | Bun 1.4.2 create |
| ---------------------- | -------------: | ----------------------: | ---------------: |
| Getter literal (today) |         596 ms |                1,490 KB |            58 ms |
| Prototype getters      |          83 ms |                    1 KB |            47 ms |

Task 081.14's Proxy rewrites removed most getters too, but cost CPU on reads and cost Bun
3–9%, so they weren't shipped. Prototype getters keep fast-mode objects and plain property
reads.

## Design

- A build plugin beside `bundle/solid-props.ts` rewrites compiled props literals that
  have getters, at `createComponent`, `mergeProps`, and `ssrElement` call sites, into
  `new Props$N(…)`. Each site's class holds the getter bodies as functions in fields and
  defines its getters once, enumerable, on the prototype. Literals with spreads, setters,
  or `this`/`arguments` in a getter stay as they are; computed literal keys such as
  `get ["class"]()` are rewritten too.
- Solid's server `mergeProps` and `splitProps`, adapted as `solid-props.ts` already does,
  see a site object's keys and re-home its getters to read from the source object, as
  [next-yak#659](https://github.com/DigitecGalaxus/next-yak/pull/659) does for Solid 2.0.
  They should stop defining a getter per key per call, for example with one cached class
  per key list.
- Getters are inherited, not own properties, so `Object.keys`, spread, and
  `getOwnPropertyDescriptors` on props see none of them. Find every such read in the app,
  Kobalte, TanStack's Solid packages, and `@solidjs/meta` in the server bundle, and adapt
  or exclude those sites.
- `bundle/build.ts` writes the rewritten bundle beside the plain one. Each engine picks
  its bundle at startup (V8 in the render crate's snapshot, Bun in the planned sidecar),
  and the plain bundle stays the default until the measurements below pick a winner per
  engine. The browser bundle is unchanged.

## Acceptance criteria

- [ ] The rewrite and adapters built, with the count of rewritten and skipped sites, and
      the per-page counts of `defineProperty` getters and getter literals before and after
- [ ] Byte-identical HTML on all four pages, the browser hydration check passing on the
      rewritten bundle, and a test of the adapters' own-key, descriptor, and laziness
      behaviour
- [ ] Every `Object.keys`, spread, or descriptor read of props in the server bundle
      listed, with how each is handled
- [ ] Promotion after a post-render minor GC, and scavenges and mark-compacts per page,
      before and after, as task 081.14 measured them
- [ ] CPU, p95, and peak RSS on four pages for V8 (32 MiB semi-space and V8's default)
      and for Bun, three alternating rounds against the plain bundle, as task 081.14
      measures
- [ ] The flag's default per engine decided from those numbers and recorded in the render
      README and `docs/architecture/native-rendering.md`; a variant that loses on an engine
      isn't its default there

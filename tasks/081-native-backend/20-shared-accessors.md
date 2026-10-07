# 081.20: Server props with shared own accessors

Status: done

Task 081.19's prototype getters cut getter creation per page from thousands to tens, but
the render CPU didn't follow. On V8 the report pages got 2–12% faster, while the timer got
23–36% slower; on Bun every page got 20–36% slower and peak RSS rose by about 45 MB
([report](server-rendering/prototype-props-wsl.md)). Because the getters were inherited,
every `Object.keys`, spread, and descriptor read of props needed an adapter: 743 audited
operations across Solid, Kobalte, TanStack, and `@solidjs/meta`.

Solid 2.0 shipped a different form ([solid#3550](https://github.com/solidjs/solid/pull/3550),
merged 2026-09-22, `hoistProps` on by default). Each call site gets a module-level
constructor; the closure goes in a symbol slot, and the getter stays an **own** property
defined from one descriptor shared by every instance:

```js
const _p$ = Symbol()
const _d$ = {
  get() {
    return this[_p$]()
  },
  enumerable: true,
  configurable: true,
}
function _P$(_p) {
  this[_p$] = _p
  Object.defineProperty(this, 'active', _d$)
}
createComponent(Button, new _P$(sig))
```

Own keys, key order, descriptor flags, and the prototype match today's literals, so
enumeration and spread need no adapters. The one broken contract is copying a
descriptor to another object (`defineProperty(target, k, getOwnPropertyDescriptor(props, k))`),
because the shared getter reads its receiver; Solid re-homes those copies
([solid#3544](https://github.com/solidjs/solid/pull/3544)). Solid reports 15–31% faster
SSR on component-heavy pages.

This task backports that form to Solid 1's server bundle and measures it against the
plain bundle and task 081.19's variant.

## Design

- Reuse task 081.19's post-bundle Acorn pass in `bundle/prototype-props.ts` for site
  detection and its fallbacks (spreads, setters, methods, receiver references). Change
  what it emits to the constructor above. Symbol slots and one shared descriptor per
  getter key are the starting point; try one slot per getter against a single slot
  object only if the measurements call for it.
- Make Solid's server `mergeProps` and `splitProps` (adapted in `bundle/solid-props.ts`)
  define their getters from cached shared descriptors per key list, instead of a fresh
  closure per key per call.
- Re-home descriptor copies. Task 081.19's [audit](server-rendering/prototype-props-audit.jsonl)
  lists every reflection operation in the bundle; only the descriptor reads followed by a
  `defineProperty` onto another object should need changes. Remove the enumeration and
  spread guards that the own-accessor form no longer needs.
- Check first, with a microbenchmark, that V8 keeps these objects in fast mode and shares
  one `AccessorPair` across instances through map transitions. If it allocates a pair per
  instance, the form can't fix V8's promotion, and the task stops there with that result.
- `bundle/build.ts` emits the new variant beside the plain one, under the same
  `RENDER_PROTOTYPE_PROPS` switch or a renamed one. Keep 081.19's variant only until the
  measurements below are in.

## Acceptance criteria

- [x] A V8 and Bun microbenchmark comparing getter literals, 081.19's prototype getters,
      and shared own accessors: creation time, map sharing (`%HaveSameMap`), and bytes
      promoted after dropping 2,000 objects
- [x] The rewrite built, with rewritten and skipped site counts, per-page counts of
      `defineProperty` getters and getter literals, and a test of own keys, key order,
      descriptor flags, laziness, and re-homed descriptor copies
- [x] The adapters that 081.19 needed and this form doesn't, removed; each remaining one
      listed with the audit rows it covers
- [x] Byte-identical HTML on all four pages and the browser hydration check passing
- [x] Plain, 081.19's prototype variant, and the new variant measured on the same
      machine in one session, as task 081.19 measured them: CPU, p95, and peak RSS on
      four pages for V8 (default and 32 MiB semi-space) and Bun, three alternating rounds,
      plus promotion, scavenges, and mark-compacts per page
- [x] If the new variant is slower on any page, the cause found with a profile, not left
      as an anomaly; the same for 081.19's timer regression if the new form shares it
- [x] The default per engine decided and recorded in the render README and
      `docs/architecture/native-rendering.md`. Remove the losing variant's code; if
      neither variant wins on an engine, remove both and keep only the reports

## Closing the engine gap

Kait wants the embedded V8 renderer good enough that the Bun sidecar stays optional, so
Snowtime can ship as one self-contained binary, for example on embedded systems. On task
081.19's numbers, plain Bun renders each page in 60–65% of V8's best CPU time (timer
11.1 ms against 17.3 ms).

If the measurements above leave V8's best bundle more than 1.2 times Bun's plain bundle in
render CPU on any page, profile V8 again and try further changes. This part is for a
follow-up task if the session runs out of time. Each change is measured as above and kept
only if it wins without costing Bun.

- [x] V8's best bundle within 1.2 times Bun's plain bundle in render CPU on every page, or
      a profile of the remaining gap with each change tried and its measured effect

## Results

V8 uses the shared bundle (`RENDER_PROPS=shared`), and Bun keeps the plain one. Measured
on the Mac in one session:

- **V8:** shared takes 3–22% off render CPU on every page at both semi-space settings,
  with lower p95, peak RSS, promotion, and GC counts.
- **Bun:** shared costs 10–21% more.
- **Prototype bundle:** task 081.19's prototype getters lost to plain on V8's timer and
  week pages and on every Bun page, and their code is removed.

V8's best bundle is still 1.26–1.38 times Bun's plain bundle, so task 081.21 continues the
profiling. [The Mac report](server-rendering/shared-props-mac.md) records the gate,
measurements, diagnostics, and every change tried.

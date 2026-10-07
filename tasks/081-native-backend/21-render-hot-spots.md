# 081.21: Further render hot spots

Status: done

Task 081.20 left V8's best bundle at 1.26–1.38 times Bun's plain bundle in render CPU,
above the 1.2 target. The changes that helped there were
small, local rewrites of hot bundle code: keeping splitProps' descriptor map in fast mode,
and copying plain data props by assignment instead of `defineProperty`. Each took 3–5% off
the renders. This task looks for more of the same in one short profiling pass. A change
stays only if it wins on V8 without costing Bun.

Candidates from task 081.20's last V8 timer profile, with self-time shares at a 32 MiB
semi-space:

- The descriptor cache lookups in the shared merge and split (`renderSharedCache`, 2.2%),
  for example through a cache per key list rather than per key.
- `mergeProps`' key enumeration (`renderSharedMerge`, 5.3%): its filter, `for…in`, and
  `includes` per source key.
- `splitProps`' `Object.getOwnPropertyDescriptors` (`renderSharedSplit`, 4.2%), which
  allocates a descriptor for every key of the source.
- The app's own hot spots: `uses12Hours` (1.2%) and Lucide's icon building (about 3%).
- Bun's `encode` and `injectAssets` (9.5% and 8.8% of Bun's samples), which don't count
  toward the gap but would help the sidecar.

A larger, separate experiment: on the server Solid renders once, so a getter only means
"evaluate later". Reading a prop early is safe unless it renders JSX, moves hydration
keys, or relies on a guard. If `mergeProps` and `splitProps` copied such props as plain
values, they would need no `defineProperty` at all and would be close to a spread. A
hand-kept list of lazy keys (`children`, `fallback`, slot props) is fragile. Instead, the
build pass already sees every getter body and can mark the getters that can't render JSX
or call components, such as literals, template strings, and plain member reads of data.
Only those would be read early. This changes the props contract, so it runs behind its
own flag, needs identical HTML and the hydration check on every page, and is decided
separately from the speed-only rewrites above.

Task 081.20 also tried copying prebuilt boilerplates with a host op around
`v8::Object::Clone`. It was 5 times faster in a microbenchmark, but slower in pages and
raised peak RSS ([patch](server-rendering/shared-props-mac-clone.patch)); it's out of
scope here.

## Acceptance criteria

- [x] One V8 and one Bun profile of the timer and year pages on the shared bundle
- [x] Each candidate tried, with two alternating quick rounds on V8 and Bun and identical
      HTML; the winners kept and the rest listed with their effect
- [x] If any change is kept, the full three-round measurement repeated as task 081.20 ran
      it, and the gap to Bun recorded

## Results

Six changes take 7–17% off V8's render CPU on every page, against task 081.20's shared
bundle, measured in one session:

- the `uses12Hours` cache
- the merge key listing
- the split fast path for merge results
- the descriptor lookup
- two Lucide `Icon` patches

V8's best bundle is now 1.12–1.27 times Bun's plain bundle: the timer and week pages meet
the 1.2 target, and month and year don't. The defaults don't change: V8 keeps shared and
Bun keeps plain.

The early-read props experiment stopped at its first measurement: early getters make only
5–8% of merge and split keys copyable. [The Mac report](server-rendering/hot-spots-mac.md)
records each change's quick rounds, the full measurement, the profiles, the early-read
counts, and follow-ups (minification, Lucide's icon building, and month and year).

# 081.22: Render follow-ups

Status: todo

A short pass over [task 081.21's follow-ups](server-rendering/hot-spots-mac.md#follow-ups):
cheap fixes only. V8's shared bundle is 1.12–1.27 times Bun's plain bundle; month and year
miss the 1.2 target. A change stays only if it wins on V8 without costing Bun. Fixes in app
code (`src/`) go to `main` as soon as they're verified, each as its own commit.

## Started

- `3f58a26` (app code): `formatIsoDateRange` caches its formatter like `formatDateTime`
  does, and `wallClock` parses `format()` instead of calling `formatToParts`, which falls
  back to the parts for unexpected text. A sweep of 500,880 instants in 8 zones from 1990
  to 2040 matched `formatToParts` exactly. Not measured yet: `wallClock` was 4.6% of Bun's
  timer and `formatIsoDateRange` 1.6% of V8's year.
- Minification, not committed. A minified bundle serializes minified function sources into
  the page stream, so its HTML must match a plain bundle minified the same way, and the
  hydration check must pass. Two candidates:
  - `minifySync` from `rolldown/utils` with `compress: true`, `mangle: false`, and
    whitespace removal: 2.7 to 2.0 MB for the shared bundle. Its timer HTML matched the
    minified plain bundle's on Bun.
  - Bun's re-print, `bun build --no-bundle --minify-syntax --target=bun`, embedded in V8.
    It only matters for V8, because Bun re-prints every bundle it loads.

## Acceptance criteria

- [ ] The app fixes measured in quick rounds (timer and year, plus month for
      `formatIsoDateRange`), and cherry-picked to `main` if they win
- [ ] Both minification candidates measured on V8, and the rolldown one on Bun too; if one
      wins, added to `bundle/build.ts` with function names kept, with the hydration check
      passing
- [ ] Lucide's remaining icon building (`buildLucideIconNode` and `Icon`, about 3% of V8's
      timer) tried only if a small patch in `bundle/lucide-nodes.ts` covers it
- [ ] Results added to task 081.21's report, and the full three-round measurement repeated
      if anything is kept

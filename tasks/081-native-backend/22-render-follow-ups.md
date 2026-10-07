# 081.22: Render follow-ups

Status: done (2026-10-07)

A short pass over [task 081.21's follow-ups](server-rendering/hot-spots-mac.md#follow-ups):
cheap fixes only. V8's shared bundle is 1.12–1.27 times Bun's plain bundle; month and year
miss the 1.2 target. A change stays only if it wins on V8 without costing Bun. Fixes in app
code (`src/`) go to `main` as soon as they're verified, each as its own commit.

## Result

The app fixes and minification are kept; Lucide's icon building is not
([results](server-rendering/hot-spots-mac.md#task-08122s-follow-ups)). V8's CPU is
unchanged within noise except month (−6%), and its loaded RSS falls 7–9 MB on every page.
The app fixes help Bun as much, so V8 stays at 1.21–1.30 times Bun's plain bundle.

## Acceptance criteria

- [x] The app fixes measured in quick rounds (timer and year, plus month for
      `formatIsoDateRange`), and cherry-picked to `main` if they win
- [x] Both minification candidates measured on V8, and the rolldown one on Bun too; if one
      wins, added to `bundle/build.ts` with function names kept, with the hydration check
      passing
- [x] Lucide's remaining icon building (`buildLucideIconNode` and `Icon`, about 3% of V8's
      timer) tried only if a small patch in `bundle/lucide-nodes.ts` covers it
- [x] Results added to task 081.21's report, and the full three-round measurement repeated
      if anything is kept

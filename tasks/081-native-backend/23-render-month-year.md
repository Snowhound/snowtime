# 081.23: Month and year render hot spots

Status: done (2026-10-07)

V8 in the host is the render engine (Kait, 2026-10-07), and Kait wants the app's renders
as fast as reasonably possible. After [task 081.22](22-render-follow-ups.md), V8's shared
bundle is 1.21 times Bun's plain bundle on the timer, but 1.27 on month and 1.29 on year
([report](server-rendering/hot-spots-mac.md#task-08122s-follow-ups)). Their remaining gap
is in the report code and the shared site getter, not in merge and split. This task finds
it with fresh profiles of month and year, and keeps only small, local rewrites. A change
stays only if it wins on V8 without costing Bun. Fixes in app code (`src/`) go to `main`
as soon as they're verified, each as its own commit.

## Result

No candidate qualifies. Duration improves both engines in four quick rounds, but its
longer confirmation costs V8 and Bun shared on month. All seven candidates are reverted;
no app fix needs a cherry-pick. [Profiles and results](server-rendering/hot-spots-mac.md#task-08123s-additional-candidates)
record both passes and their raw runs. Router hydration-state serialization and GC
remain outside this task.

## Known so far

- **The shared site getter** (`renderSharedSite` in `bundle/shared-props.ts`) is the largest
  props cost on V8's year page, 3.2% of self time. One getter function serves every site
  and reads its slot through `this[slot]`, so that read can't stay monomorphic.
- **The report code.** Nobody has profiled month and year for the app's own functions
  since task 081.20. `formatIsoDateRange` and `wallClock` were fixed in task 081.22.
- **Lucide's icon building** (`buildLucideIconNode` and `Icon`) is about 3% of V8's timer:
  `mergeClasses`, alias class lists, and attribute spreads for every icon. Task 081.22
  found that a small addition to `bundle/lucide-nodes.ts` doesn't cover it; a replacement
  of the function in that build-time patch might, if the build still fails when Lucide's
  `Icon` changes.

## Method

As in tasks 081.21 and 081.22, on the M1 Pro in Docker Desktop, one CPU and 2 GiB per
container, with the render crate's recorded answers (`native/crates/render/README.md`):

- Profile V8 (32 MiB semi-space, `RENDER_CPU_PROFILE`) and Bun on month and year before
  choosing changes, and attribute self time to app functions, bundle runtime, and Solid.
- Check each change with alternating quick rounds: V8 at 32 MiB on the shared bundle, Bun
  on both bundles, four rounds, month and year plus the timer for shared code. A one-CPU
  container can land on an efficiency core, and single runs jump 20–30%, so run nothing
  CPU-heavy alongside and never compare absolute numbers across sessions.
- Compare HTML with the plain bundle built the same way on the same engine. The bundle is
  minified, so serialized function sources differ between V8 and Bun.
- Kait's ignored helper scripts on this machine do the above:
  `native/crates/render/results/q21/scripts/` (`build.sh`, `quick.sh` with `PAGES`,
  `prof.sh`, `psum.py`, `callers.py`, `checks.sh`, `full22.sh`).

## Acceptance criteria

- [x] V8 and Bun profiles of month and year, with the top self-time functions in the
      report's Profiles section
- [x] Each candidate measured in quick rounds and kept only if it wins on V8 without
      costing Bun; app fixes cherry-picked to `main`
- [x] The shared site getter tried, or the reason it can't be made cheaper recorded
- [x] Lucide's icon building tried as a replacement in `bundle/lucide-nodes.ts`, kept
      only if it wins and the build still fails on an unknown `Icon`
- [x] If anything is kept: the hydration check passing on all four pages, and the full
      three-round measurement repeated, with results added to task 081.21's report

# 069: Performance review

Status: in-progress

A measured pass over what the app sends, what the server reads, and what the scene draws.
Tasks 037, 044, 045, 057, 059, and 063 fixed the known slow spots one at a time. This task
first builds harnesses that let later changes check themselves, then works through the
remaining costs: CSS, HTML, and JavaScript sent to the client; the report queries; and the
weather's shaders, its fog, and the glass surfaces over it.

## Rules for the whole task

- Measure first. Each subtask starts with numbers from the harness (subtask 01) and fixes
  what they show. A candidate that saves little goes under "Checked and left as is" with its
  numbers, as task 037 did, so nobody measures it again.
- Keep the code readable. An optimization stays local: one function, one shader, one query,
  with a comment that says why it's written that way. Don't add an app-wide indirection, a
  cache layer, or a build step for a gain under about 5% of the thing it speeds up.
- Easy wins count, especially when they remove code, classes, or bytes.
- Fix real bottlenecks even when the fix is larger. The subtask records why it was worth it.
- Make the general case fast, on every machine. A low-end mode (fewer or simpler effects
  on weak hardware) is a last resort: consider it only for a few outliers that nothing else
  makes cheap enough, with their numbers, and ask Kait first.

## No reference machine

Kait has no idle machine that gives stable timings, so the harness gates regressions on
counts that don't depend on the machine, and only reports timings:

| Gated (exact or with a small tolerance) | Reported (compared within one run)    |
| --------------------------------------- | ------------------------------------- |
| Gzipped JS per route, CSS, HTML bytes   | Server function time, SSR render time |
| Query plans (no full scans of entries)  | Frame time, GPU time, uncapped fps    |
| Rows read and returned per report       | Long tasks, hydration time            |
| DOM nodes per page on the year of data  |                                       |
| Weather frames at fixed times (pixels)  |                                       |

Timings compare before and after in the same run, interleaved (A, B, A, B), as ratios. An
absolute threshold on a shared laptop only produces noise.

The "potato" proxy is Chrome with SwiftShader, its software WebGL (`--use-angle=swiftshader`).
It runs on the CPU, so it's slow, but it's the same everywhere and exaggerates fill-rate costs,
which are what a weak integrated GPU runs out of first.

## Subtasks

1. `01-harness.md`: the harnesses and budgets. Everything else measures with them.
2. `02-css-and-html.md`: Tailwind output, class usage, render cost of CSS, and SSR HTML size.
3. `03-js-bundles.md`: the shape of the client chunks and the server bundle.
4. `04-server-queries.md`: report aggregation in SQL, indexes, and rows read.
5. `05-weather-under-glass.md`: stop drawing, and blurring, weather that the glass surfaces hide.
6. `06-weather-shaders.md`: tidy, specialized shaders without divergent branches.
7. `07-fog.md`: a cheaper way to draw the mist.
8. `08-scene-layers.md`: image decode, GPU memory, and full-screen layers under the weather.
9. `09-webgpu-probe.md`: whether WebGPU would help enough to keep a second renderer.
10. `10-report-table.md`: the report timesheet's HTML and hydration cost.

01 comes first. After it, 04, 02, and 03 are the cheap, independent ones; 05 to 07 build on
each other; 08 and 10 can go at any point; 09 goes last.

The effects and the fog don't have to look exactly as they do now. A faster variant that
looks somewhat different, or a new idea, goes to Kait in the weather bench beside the
current one, and Kait signs it off.

## Acceptance criteria

- [x] Subtask 01 done, and `docs/architecture.md` says how to run the harnesses
- [ ] Subtasks 02 to 10 done, each with before and after numbers and a "Checked and left as
      is" list
- [ ] The weather at calm pace, with the glass on, fits in 8 ms a frame (120 fps) on an
      integrated GPU at 1440 × 900, pixel ratio 1.5, on the timer and reports pages. This is a
      goal to measure against, not a hard limit; if it can't be met, the task records what
      holds it back.
- [ ] Every change passes `bun run test`, lint, and the harness budgets

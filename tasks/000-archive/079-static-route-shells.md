# 079: Static route shells

Status: cancelled (Kait, 2026-10-03: a failed experiment; the native backend server-renders
pages instead, task 081.01)

Serve each page as an HTML file built ahead of time instead of rendering it on the server
for every request. The shell holds everything that isn't per-user, with the route's
skeleton where per-user content goes. The client fetches the data, renders without
hydration, and routes as it does today. Server rendering is the largest cost on today's
server: 15 to 50 ms of CPU for an ordinary page and 85 to 92 ms for the 9-month report
(`docs/hosting.md`), and up to 385 KB of HTML for the year report
(`perf/baselines/pages.json`). Without it, Caddy or Vercel's CDN serves the pages, and task
081's native backend only has to answer the API. Users must be no worse off, measured
before and after.

## Why it was cancelled

The shells were built and measured, and a warm load showed content 430–480 ms later than a
server-rendered page, at 4× CPU slowdown on Fast 4G. The gap is the client's first render
of the page ("Client render profile"), which no shell can avoid: embedding the reads in the
HTML would have saved 30–40 ms of it. Task 081.01 then found that a V8 isolate in the Rust
server renders the same pages in 6–20 ms and that Start's client hydrates its output, so
the native backend renders pages and the reason for shells went away.

The code is on the local branch `079-static-route-shells` (never pushed): the prerendered
shells, the edge routing in both Caddyfiles and Vercel's routes, the hash-based content
security policy, the head start for each page's reads, and the skeletons. The `perf:pages`
and `perf:load` measurements it added moved to their own branch.

## Outcome

The rendering design is recorded in "Rendering" (`docs/architecture/platform.md`).

**Build approach.** Start's prerenderer with `defaultSsr: false`, and a custom client entry
(`src/client.tsx`) that renders instead of hydrating. Every route then renders its
`pendingComponent` on the server, so the prerenderer writes one shell per route and
language with Start's own head, preloads, and language. SPA mode writes a single shell
for every route, so it has no per-route skeleton. A plain Vite build of the client would
have to repeat the head and the preloads that Start's render already gives.

**Changes from "Design to confirm":**

- The edge doesn't redirect a signed-out request: it serves the sign-in shell at the same
  URL, and the client redirects. Neither Caddy nor Vercel can URL-encode the page to come
  back to into the redirect.
- The theme before the session loads comes from the device's copy of the account settings
  (`followAccountDeviceSettings`), not from a new cookie.
- The sign-in page is a skeleton (`AuthPending`), not prerendered with content: its
  buttons are the deployment's sign-in methods, which a server function reads. Privacy and
  terms are prerendered with their content.
- The head start notes each page's first-load reads in localStorage and replays them on
  the next load of that address the same day; it doesn't derive them from the URL. The
  session read goes out on every load, cold ones included. The shell also preloads the
  page's own chunks, which Start's head tags leave out below a route that hasn't loaded.
- Vercel's routes are in Nitro's `vercel.config` (`vite.config.ts`), not `vercel.json`.
- Hydration was considered once more on 2026-10-02 and stays off: a shell holds a
  skeleton, not the user's content, so there is nothing to hydrate the page into.

## Measured

`bun perf/pages.ts --build=<dir>` on 2026-10-02, before (main at `2c2d585`) and after,
alternated twice. Each cell is the mean of the two runs' medians, in ms from navigation, at
4× CPU slowdown on Fast 4G. Content and ready are the same moment for a page the browser
renders.

| Load               | Before: paint / content / ready | After: paint / content |
| ------------------ | ------------------------------- | ---------------------- |
| Timer, cold        | 1030 / 970 / 2412               | 778 / 2414             |
| Timer, warm        | 360 / 294 / 745                 | 330 / 722              |
| Reports week, cold | 934 / 883 / 2191                | 784 / 2348             |
| Reports week, warm | 342 / 281 / 631                 | 322 / 713              |
| Reports year, cold | 1232 / 1152 / 2384              | 772 / 2433             |
| Reports year, warm | 352 / 282 / 887                 | 322 / 765              |

- A cold load paints the skeleton 150–460 ms sooner and has its content at about the time
  the old page became interactive (+2 to +157 ms). Kait accepted a cold-load regression as
  long as in-app navigation stays fast.
- A warm load's content comes 430–480 ms later than before, because the old HTML carried
  it, so the "no worse with a warm cache" rule isn't met. It is interactive about as soon:
  23 and 122 ms sooner on the timer and the year report, 82 ms later on the week report.
  The data arrives at about 410 ms; the rest is the main thread, mostly one render of the
  page (about 280 ms at 4× slowdown), which costs about what hydration did.
- Interactions are unchanged: start timer 52–60 ms, previous range 31–33 ms to paint.
  In-app navigation with the header's link is 120–140 ms on both.
- HTML is 81–89% smaller gzipped on the app pages (3.3 KB per shell); JS is up 0.5%.

`bun run perf:load` on the same machine, CPU per page load: rendering the page on the
server took 34 ms for the timer, 22 ms for settings, 18 ms for the week report, and 52 ms
for the year report. The shells' reads take 15, 7, 10, and 48 ms; a shell itself costs the
app nothing. RSS peaked at 306 MB against 502 MB.

Task 078's harness (`perf:stress`) isn't merged yet, and another session is changing it and
running its Docker stack, so its numbers before and after wait for the merge. Its recorder
records what the browser sends per build, so after this task a page load replays as a
document Caddy serves plus the page's reads.

## Client render profile

Traced on 2026-10-02 after the preload commit, warm load of the timer at 4× CPU slowdown on
Fast 4G, with an unminified build to read the names. The code is ready at about 470 ms and
the reads arrive at about 500 ms, so embedding the data in the HTML would save 30–40 ms
on a warm load. Then one task of 280–430 ms renders the page (tracing adds overhead), its
cost spread across the tree:

- Solid's `template()` parsing each template's HTML on first use: about 88 ms. Every client
  render pays it; hydration doesn't.
- The entry rows: about 92 ms for the 12 rows that mount at once (`createLazyDays` already
  defers the rest, and each row's menu mounts on activation).
- The header and app frame: about 68 ms. Kobalte's `Polymorphic`: about 48 ms.

More lazy mounting inside a row could save 50–100 ms at 4×, which leaves content near
600 ms against 290 ms with server rendering. That gap is why Kait chose server rendering
(task 081.01).

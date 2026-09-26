# 06: Rendering and loading cost

Status: in-progress (measured; the code review of the criteria has not started)

Task 045 found the timer page mounting a full editor in every row, about 175 popovers
for 35 rows. Check the other pages and shared components for the same kinds of cost.
Measure on a local production build with the seeded data, and on a CPU throttled 4× in
Chrome's Performance panel.

## Acceptance criteria

- [ ] No page mounts heavy components (popovers, pickers, comboboxes, editors) for
      every row or item when a lighter view would look the same until used
- [ ] No per-second timer, resize, or scroll handler re-renders more than the part that
      changes
- [ ] Effects that only derive values are memos, and no effect writes a signal that
      reruns it
- [ ] Each query has a sensible `staleTime`, and mutations invalidate only what they
      change
- [ ] The client bundle has no server-only code or large dependency that a page doesn't
      need at first load; routes split where it pays
- [ ] Opening each page stays under 50 ms of main-thread work on the fast machine,
      or the page gets a task

## Findings

Measured on 2026-09-26 on a local production build (`vite build`, served on port 3100) with
a freshly seeded throwaway database, as the seeded owner, at 1440 × 900 in headless Chrome.
CPU slowdown was set through the DevTools protocol, the Performance panel's setting. The
harness is Playwright, run from outside the repository. Each run clicks a page's link (Settings
from the user menu) after visiting it once, so the data is cached, and traces the next 1.5 s.
Numbers are the range over the runs, in milliseconds. "Idle" is the same 1.5 s with no click,
mostly the scene's weather.

| Page         | Longest task, 1× | Tasks, 1× | Idle, 1× | Longest task, 4× | Tasks, 4× | Idle, 4× | DOM nodes |
| ------------ | ---------------- | --------- | -------- | ---------------- | --------- | -------- | --------- |
| Timer        | 79–82            | 123–127   | 21–22    | 406–438          | 540–542   | 79–80    | 2,649     |
| Reports      | 19–25            | 50–68     | 22–24    | 84–110           | 170–226   | 51–61    | 550       |
| Projects     | 15–18            | 45–49     | 21–24    | 63–74            | 138–160   | 55–61    | 239       |
| Organization | 17–18            | 48–52     | 23–25    | 68–101           | 139–188   | 55–64    | 371       |
| Settings     | 44–48            | 87–95     | 21–23    | 188–194          | 330–336   | 68–69    | 795       |

- Subtracting the idle work, every page but the timer opens in under 50 ms of main-thread
  work at 1×, and Settings is closest to the limit. The timer takes about 100 ms, one task
  of about 80 ms, which matches task 045's result (74–92 ms frames). Its rows mount no
  Kobalte triggers, but they still have 2,649 nodes, 417 inputs and buttons, and 240 SVGs
  for 35 rows. It needs a task of its own if 50 ms is the bar.
- The first visit to a page (data not cached) wasn't measured reliably. The harness waited
  about 11 s for Playwright's load event, which a client navigation never fires. The numbers
  are left out rather than guessed.

Not yet checked: the per-second tick (the entry list's day headers read `now` only for
"Today" and "Yesterday", so they could take the day instead), effects that only derive
values, each query's `staleTime` and invalidations, and the client bundle.

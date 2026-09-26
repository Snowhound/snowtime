# 06: Rendering and loading cost

Status: todo

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

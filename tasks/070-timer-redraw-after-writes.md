# 070: Timer page redraws after each write

Status: todo

After each entry write on the Timer page (a row edit, a calendar move), the page's nodes are
removed and put back a few times within about 50 ms, which drops focus and resets scroll
positions inside the page. It happens on `main` before task 069 too, in List view.

Found on 2026-09-29 in the dev app: `<main>` in `app-frame.tsx` reinserts the Timer view's root
from its children's render effect (Solid's `reconcileArrays`), with no router navigation or
load. A `Suspense` boundary inside `TimerPage` doesn't stop the focus loss. Leaving out the
session query's invalidation doesn't either. Solid Query's `data` getter reads its resource
while a query has no data, which suspends the nearest boundary, and is one suspect. On the
first load in development the app frame moves inside `<body>` the same way.

The calendar works around it: it gives focus back to an entry an Alt+arrow key moved, and
keeps its opening scroll until the user scrolls (`calendar/timer-calendar.tsx`).

## Acceptance criteria

- [ ] The cause is found, and a write no longer moves the page's nodes
- [ ] A list row keeps focus on its field across a save, as `prototypes/README.md` records
- [ ] The calendar's focus and scroll workarounds are removed, and its focus still holds

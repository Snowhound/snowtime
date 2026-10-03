# 082: Glass page actions over the scene

Status: todo

In light mode over a bright scene photo, the page actions above the cards read poorly.
On the timer page (seen over the autumn photo, in Estonian):

- The view switch's selected item (Nimekiri) and the Add time button (Lisa aeg) have flat
  pale-blue fills. They could take the same glass as the cards and the header.
- The unselected view item (Kalender) has no fill at all, so its label sits straight on the
  photo and is hard to read.

The same toggle groups elsewhere have the second problem, such as Week and Breakdown
(Nädal, Jaotus) in the Reports filter bar. The timer's switch is a `ToggleGroup` with
`variant="outline"` (`src/features/timer/timer-view.tsx`); Add time is a `secondary`
`Button`. The Reports switch is in `src/features/reports/filter-bar.tsx`.

## Acceptance criteria

- [ ] Every toggle group and page action that sits on the scene, rather than on a card,
      found and listed
- [ ] Selected and unselected toggle items and the secondary page actions readable over the
      brightest and busiest scene photos in light mode, checked in the browser, with the
      dark theme and the Solid surfaces setting no worse
- [ ] The look agreed with Kait before the change spreads beyond the timer page

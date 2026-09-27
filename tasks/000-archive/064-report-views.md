# 064: Report views

Status: done

Reports gets three views of one report, as tabs: Timesheet (the grid the app has now),
Summary, and Breakdown. The design is in `prototypes/reports.html` and its entry in
`prototypes/README.md` ("Reports"). Summary shows at a glance where the time went and reads
on a phone, where the timesheet scrolls sideways. Breakdown shows who worked on what.

## Acceptance criteria

- [x] Tabs Timesheet, Summary, and Breakdown sit between the filters and the report, at the
      header's 68rem, with Export at the right of the tab row. Export keeps giving the
      timesheet and its entries on every tab.
- [x] The view is a search param (`view=summary` or `view=breakdown`); Timesheet is the
      default and has none. Reports opens on Timesheet; the last view isn't remembered.
      Switching views clears the Entries card's narrowing, as a filter change does.
- [x] The timesheet keeps its width (it widens with its columns up to the window's).
      Summary and Breakdown take the header's 68rem.
- [x] Summary: one line with the total, the average per tracked day ("over N of M days"),
      and the top project, instead of stat tiles. Under it, stacked columns per day or week,
      always by project, with the projects past seven folded into "Other", a hover and focus
      tooltip, and a Table tab with the same values. Under that, share bars by the chosen
      grouping.
- [x] `getReport` returns the number of days with time (`trackedDays`), so the average holds
      when totals are per week.
- [x] Breakdown: a two-level outline with share bars and the first three groups open.
      Project, then member; ticket, then member; team, then member; member, then project.
      Members see one level. Totals per is disabled on Breakdown, since it totals the range.
- [x] A server function returns the second level's totals (project × member and ticket ×
      member) under `getReport`'s rules. Only Breakdown loads it, so the other views' report
      stays the size it is. Team, then member comes from team membership.
- [x] The Entries card sits under every view and narrows from each: the timesheet's names and
      totals as now, a Summary chart column (its day or week) or share-bar name, and a
      Breakdown top-level total. A second-level row doesn't narrow.
- [x] Tests cover `trackedDays`, the second-level totals and their role rules, the chart's
      series and "Other", the view param, and narrowing from Summary and Breakdown.
- [x] `docs/architecture.md` records the views and the Breakdown function; the prototype
      README entry says the views are in the app.
- [x] Checked in the dev app at 1440, 1280, and 390 px, light and dark, as member, team lead,
      and admin: no horizontal page scroll and no console errors.

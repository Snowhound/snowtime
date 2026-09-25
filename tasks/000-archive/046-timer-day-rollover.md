# 046: Timer view after midnight

Status: done

Task 039 found on 2026-09-25 that the timer view keeps the day it opened on. `now` in
`timer-view.tsx` ticks only while a timer runs, and the list's range
(`recentRange(zone(), days())`) is computed once, since its memo tracks only the zone and
the number of days. With the tab left open past midnight in the user's zone:

- The day labels, and "Today" and "This week" in the summary, stay on the previous day
  while no timer runs.
- Whether a timer runs or not, the list still asks `listEntries` for the days up to the
  midnight that passed. A timer started or an entry logged after it is saved, but drops
  out of the list on the next refetch, and comes back only on a reload.

Seen in Chrome with the system time set to 23:59:30 in Tallinn: after midnight the list
still labeled the day before "Yesterday".

## Acceptance criteria

- [x] The view has a today in the user's zone that changes at the zone's next midnight
      (`startOfDay`), whether or not a timer runs, and the range, day labels, and summary
      follow it. It's read again when the tab shows, since a timeout can fire late after
      the device sleeps
- [x] A component test with a fake clock crosses midnight and finds a new entry
      listed, under "Today", with yesterday's entry under "Yesterday"
- [x] A report keeps the day it was requested on, like its totals, until its filters
      change, as `docs/architecture.md` ("Time zones") now records

# 05: More dated sets

Status: done

Much of the calendar has no set: most of January, February, spring, June before
Midsummer, and the days after Christmas. Add sets for these dates, most in both languages,
the Estonian customs in Estonian only. Movable dates come from Easter or a weekday rule.

Candidates:

| Date                                    | Language | Idea                                                               |
| --------------------------------------- | -------- | ------------------------------------------------------------------ |
| First working day of each month         | Both     | New month. / Last month's hours aren't coming with you.            |
| 14 February                             | Both     | Show your timesheet some love.                                     |
| Shrove Tuesday (Easter − 47)            | et       | Sledging: the longer the slide, the longer the gap.                |
| 14 March, Pi Day                        | en       | Your hours shouldn't be irrational.                                |
| 1 April                                 | Both     | Your timesheet filled itself in. / April fool. / It's still empty. |
| Easter                                  | Both     | Hidden eggs are fun. / Hidden hours aren't.                        |
| 30 April, Walpurgis Night               | et       | The witches fly out.                                               |
| 21 June, solstice                       | Both     | The longest day. / Log all of it.                                  |
| 22–24 June                              | et       | Before the bonfire; the day before is three hours shorter.         |
| Programmers' Day (the year's 256th day) | Both     | Day 256. / 0 hours logged, apparently.                             |
| Friday the 13th                         | Both     | Something unlucky is coming. / It's the deadline.                  |
| 2 November, All Souls' Day              | et       | The ghosts of unlogged hours.                                      |
| 25 November, St Catherine's Day         | et       | A pair with St Martin's Day.                                       |
| 27–30 December                          | Both     | Nobody's working. / Your timesheet still is.                       |
| 31 December                             | Both     | Last chance this year.                                             |

Days of mourning never get a set: 14 June, 23 August, and 22 September in Estonia.

Decided on 2026-09-27: the month's first working day is its first weekday, since date
rules don't get the region. Easter shows from Good Friday to Easter Monday.

## Acceptance criteria

- [x] The sets above are in the catalogue (subtask 01), with Easter computed for movable
      dates
- [x] A test checks that no set falls on 14 June, 23 August, or 22 September
- [x] `docs/architecture/taglines.md`, lists the dated sets

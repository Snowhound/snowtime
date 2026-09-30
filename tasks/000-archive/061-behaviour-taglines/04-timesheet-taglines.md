# 04: Taglines about the timesheet

Status: done

Pick taglines from the user's own entries. The server computes a small fill summary in
the frame's loader, so the server and the browser pick the same set.

The summary, in the user's zone and region (subtasks 02 and 03), across all their
organizations:

- How long the running timer has run, if one runs
- Whether today, the last working day, last week, and last month are filled. A working day
  is filled at 6 hours or more, a shortened one at 3; a week or month when all its working
  days are.
- How many working days in a row before today are empty
- How many filled working days in a row end yesterday or today (the streak)

Order, first match wins:

1. Timer running 8 hours or more, or past midnight in the user's zone
2. Dated sets
3. A month's or week's last days (the period sets)
4. 1–2 empty working days: the gap sets. 3 or more: the welcome back set.
5. Today and everything before it filled: the praise sets
6. The last working day, week, or month filled but today not: the "and today?" sets
7. Month or season sets

The tagline keeps its set while the page is open, with one exception: when a save fills
today and the praise sets now match, the tagline switches to one with its cue.

Draft lines, English (Estonian written separately, not translated):

| Trigger                | Lines                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Timer 8 h+             | Your timer worked all night. / Did you? / Stop it and fix the hours.                                       |
| Timer at the 24 h cap  | Your timer gave up after 24 hours. / It's more committed than you. / Fix the entry before payroll sees it. |
| Last working day empty | Yesterday is missing. / Did it happen? / Log it before you forget what you did.                            |
| Monday, Friday empty   | The weekend's over. / Friday's hours still aren't in.                                                      |
| Back after 3+ days     | Welcome back. / Your timesheet noticed you were gone.                                                      |
| Yesterday filled       | Yesterday's hours are all in. / Lovely. And today's? / Don't let the streak end at one.                    |
| Last week filled       | Last week is complete. / This week has noticed. / It expects the same treatment.                           |
| Last month filled      | Last month is closed. / Don't get used to the feeling. / This one's already started.                       |
| All filled             | All caught up. / Suspicious. / We'll find something tomorrow.                                              |
| All filled             | A perfect timesheet. / Frame it; it won't last. / See you tomorrow at 9.                                   |
| 5-day streak           | Five days in a row. / Don't ruin it now.                                                                   |

"Yesterday" means the last working day; on a Monday, its set says Friday.

## Acceptance criteria

- [x] The frame's loader returns the fill summary with the session; it adds one query, and
      the query's time on the seed data is recorded here
- [x] The tagline picks sets in the order above, and the sign-in page stays seasonal
- [x] The timer set shows the timer's hours through a placeholder
- [x] Saving the entry that fills today switches the tagline to a praise set with its cue
- [x] Tests cover each trigger, holidays and weekends not counting as gaps, and the 3-day
      absence
- [x] Every set has English and Estonian lines

## Query time

`appSession` reads the summary's entries in one query, a `UNION ALL` of two index searches
(`docs/architecture/taglines.md`). On the seed data from `bun run db:seed --company` (21,234
entries), over 26 users with up to 237 rows each, it took 0.59 ms at the median, 1.13 ms at
the 95th percentile, and 1.99 ms at most. The first version, with `OR` in one `WHERE`, scanned
the table and took 11.6 ms at the median.

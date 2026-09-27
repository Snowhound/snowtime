# 02: Working days

Status: done

The gap taglines (subtask 04) must not count a day off as missing. Add a module that
answers whether a date is a working day in a region: not a weekend, not a public holiday.
Weekends are Saturday and Sunday in every region, whatever the Week start setting.

Estonia: riigipühad.ee serves its list as JSON (`https://riigipühad.ee/?output=json`),
2025–2030 as of 2026-09-27. Each entry has a `kind_id`:

| `kind_id` | Kind                                   | Use               |
| --------- | -------------------------------------- | ----------------- |
| 1         | Public holiday (riigipüha), day off    | Not a working day |
| 2         | National holiday (rahvuspüha), day off | Not a working day |
| 4         | Shortened working day                  | Kept as `short`   |
| 3         | Day of national importance (tähtpäev)  | Not kept          |

US: federal holidays by rule, plus the Friday after Thanksgiving and Christmas Eve, which
most employers give off. A fixed date on a Saturday moves to Friday, on a Sunday to Monday.
Leave out Columbus Day and Veterans Day, which most private employers work.

Other regions: weekends only.

## Acceptance criteria

- [x] `src/lib/holidays/` exports `isWorkingDay(date, region)` and
      `isShortDay(date, region)`, shared by the server and the browser
- [x] `src/lib/holidays/ee.json` holds the feed's kinds 1, 2, and 4 as
      `{ date, kind: 'off' | 'short' }`; the app never calls riigipühad.ee at runtime
- [x] `bun run holidays:update` downloads the feed and rewrites `ee.json`
- [x] A test fails when `ee.json` doesn't cover the next calendar year, so CI flags the
      refresh before the data runs out
- [x] US rules cover New Year's Day, Martin Luther King Jr. Day, Presidents' Day, Memorial
      Day, Juneteenth, Independence Day, Labor Day, Thanksgiving and the Friday after,
      Christmas Eve, and Christmas Day, with weekend dates moved as above
- [x] A test checks the US rules against the published federal dates for 2026 and 2027

# Taglines

Tagline (`src/lib/taglines/`, `src/components/page-title.tsx`): the season's own sets are
Paraglide messages in `src/lib/scene/seasons.ts`, since the intro shows them too. Every other
set is in the catalogue, `src/lib/taglines/catalogue.ts`, where each set holds its lines per
language and a `when`: a date rule, a date range, a timesheet period, or a behaviour in the
user's timesheet. The sets had stopped being translations of each other, and a message must
exist in every language; a catalogue set shows only in the languages it has. Each signed-in
page's title row places the tagline in the browser, from its measured size, so it moves under
the title when it doesn't fit.

- A season's sets take turns, one per UTC day, so the tagline doesn't wear out. The day is
  UTC's so the server and the browser pick the same set without knowing the user's zone; the
  set changes at 02:00 or 03:00 in Tallinn.
- Signed in, the calendar adds sets, by the date in the user's zone from their settings,
  which the server and the browser both have. A date range's set joins the season's in
  the turn: the holidays in July, school in September, and the elves from 1 to 19
  December. A date's set replaces the tagline. A set can be in one language only, such as
  St Martin's Day in Estonian, where it's a custom. Several sets on one date take turns.
  The dated sets (`et` or `en` marks one language):
  - Fixed dates: New Year (2–4 January), Valentine's Day, leap day, Pi Day (`en`), April
    Fools' Day, Walpurgis Night (`et`), the solstice (21 June), the days before Midsummer
    (22–24 June, `et`), Midsummer (25–27 June, `et`), Halloween, All Souls' Day (`et`),
    St Martin's Day (`et`), St Catherine's Day (`et`), Santa (20–23 December), the days
    between the holidays (27–30 December), and New Year's Eve.
  - Movable dates: the month's first weekday, except January's, which the New Year set has;
    Shrove Tuesday (`et`, Easter − 47); Easter, from Good Friday to Easter Monday, the
    working days around it; the Mondays after the EU's clock changes; Programmers' Day,
    the year's 256th day; and Friday the 13th. `easter` in `src/lib/taglines/rules.ts`
    computes Easter.
  - The month's first weekday stands in for its first working day. A date rule gets only
    the date, not the user's region, so the first weekday is wrong only when the 1st is a
    weekday holiday, such as 1 May in Estonia.
  - No dated set falls on Estonia's days of mourning: 14 June, 23 August, and
    22 September. A test checks this over 25 years of movable dates.
- Signed in, the tagline also reacts to the user's own timesheet, through a fill summary
  (`src/lib/taglines/fill.ts`). `appSession` computes it with the session in the frame's
  loader, so the server and the browser pick the same set. It covers the user's entries in
  all their organizations, from the start of last month, in their zone and region (see
  "Working days" in [data.md](data.md)):
  - A working day counts as filled at 6 hours or more, a running timer's time included,
    and a shortened working day at 3 hours less. A week or month counts as filled when all
    its working days are. The threshold is lax on purpose: the taglines are jokes and
    mustn't nag over a short day.
  - A working day with nothing logged is empty. One with some time but under 6 hours is
    neither, so it ends a streak but isn't a gap.
  - Weekends, public holidays, and the days before the account was created are never
    expected, so they're never gaps.
  - The summary holds when the running timer started; whether today, the last working
    day, last week, and last month are filled; whether every working day back to the start
    of last month is; how many working days in a row before today are empty; and the
    streak of filled working days, ending today or, while today isn't filled, before it.
  - It adds one query, a `UNION ALL` of two index searches: the entries started since the
    start of last month, less the 24 hours an entry can last, in the user's organizations;
    and a timer left running from before then. With `OR` in one `WHERE`, SQLite scanned the
    table. On the company seed data (21,234 entries), it takes about 0.6 ms.
- The tagline picks its set in this order, and the first match wins:
  1. A timer that has run 8 hours or more, or since before midnight in the user's zone.
     Its sets show the timer's hours through `{hours}`; a timer at the 24-hour cap has its
     own set.
  2. A date's set. It hides a period's set on its days, so Friday the 13th and the sets
     from 27 December name the deadline or the year's end themselves.
  3. A period's set, on a timesheet period's last days: the month's last three days, else
     Friday, whatever the week start.
  4. 1–2 empty working days in a row before today: the gap sets, which name yesterday, or
     Friday on a Monday. 3 or more: the welcome back set.
  5. On a working day, today and every working day before it filled: the praise sets. The
     streak's set shows the streak through `{days}`.
  6. On a working day, today not filled but the last working day, last week, or last
     month filled: the "and today?" sets.
  7. The season's sets and the day's ranges, in turn.

  Several sets that match one step take turns by UTC day. `taglinePick` in
  `src/lib/taglines/taglines.ts` fills the placeholders, which the catalogue test checks
  are the same in every language.

- A summary from another day, such as on a tab left open overnight, counts only for the
  running timer.
- The tagline keeps its set while the page is open: the page title keeps the summary it
  picked with. Entry writes refetch the session, and when the new summary brings on the
  praise sets, the tagline switches to one, with its cue.
- The intro and the tagline pick separately. The intro plays about four times a year and
  opens the season, so it shows only the season's sets, in turn by UTC day, never a date's
  or a range's. On the visit where the intro plays, the tagline switches to the intro's set,
  so the page picks up what the user just watched. The browser decides whether the intro
  plays, after the server has rendered the tagline; the page is hidden under the intro
  then, so the switch isn't seen.
- The sign-in page has no zone and no summary, so it shows only the season's sets.
- A tagline the browser hasn't shown before gets a cue once it's placed: a light sweeps
  across it. When it's centered and the set has a third line, the first two lines then roll
  up and fade for the third, which holds for about four seconds before they roll back. The
  tagline's box keeps its size, so nothing around it moves; if the third line is too wide
  for the title row, only the light plays. The browser decides after hydration, since only
  it knows what it showed last; hiding the server's text to fade it in would flicker on
  every load. There's no cue while the intro shows the lines or with reduced motion. A click on
  the tagline plays the cue again, since the third line shows only during the roll.
- The Tagline switch (`scene_tagline`) hides the tagline on signed-in pages. The sign-in
  page keeps it, and the intro has its own switch.

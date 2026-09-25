# 050: Season text at a season's first hours

Status: todo

Task 039 found on 2026-09-25 that the server and the browser can render different
seasons. `seasonByMonth` (`src/lib/scene.ts`) reads the month in the runtime's own zone:
UTC on Vercel, the device's zone in the browser. In the hours around midnight on 1 March,
June, September, and December, the two disagree for any user off UTC: in Tallinn, from
00:00 to 03:00 on 1 December, the server renders autumn and the browser winter.

Solid keeps the server's text when it hydrates, so the page taglines (`SeasonTagline`,
`PageTitle`) and the "Auto (season)" label stay on the server's season, while effects
move the photo and weather to the browser's. The page mixes two seasons until it reloads
after the gap. A local dev server shares the browser's zone, so this shows only when
deployed.

Signed in, both sides know the user's zone (`settings.timeZone`), so the month can come
from it. Signed out, the server doesn't know the zone, so the season text can render
after hydration instead, or from a zone the device stores.

## Acceptance criteria

- [ ] Signed in, the season follows the month in the user's time zone on the server and in
      the browser, including the head script's intro check
- [ ] Signed out, the first paint and the hydrated page show the same season
- [ ] A test renders a season-dependent text at a boundary for a zone off UTC

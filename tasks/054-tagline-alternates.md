# 054: Alternate and period taglines

Status: todo

`src/lib/scene/seasons.ts` holds more seasonal copy than the app shows. Spring, summer, and
autumn each have an alternate set of lines (`alternates`), and `PERIODS` holds taglines for a
timesheet period's last days: "It's Friday. So is the deadline." and "The month is almost out.
Your hours shouldn't be." The messages are translated, but nothing reads them, so every page
shows each season's first set. Task 031 ticked the criteria for these without wiring them up,
and nothing records how the app picks among a season's sets. Task 053 found the unused code.

## Acceptance criteria

- [ ] How the app picks among a season's sets is decided and recorded in
      `docs/architecture.md`, for example a different set per visit or per week, so the
      tagline doesn't wear out. The server and the browser pick the same set, so hydration
      keeps the text (see task 050).
- [ ] The intro and the page tagline show the picked set's lines together
- [ ] The period taglines replace the season's in a week's or month's last days, and when
      they count as the last days is decided
- [ ] A test covers the pick and the period taglines
- [ ] `knip.jsonc` no longer ignores `src/lib/scene/seasons.ts`

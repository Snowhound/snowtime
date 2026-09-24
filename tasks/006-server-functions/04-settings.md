# 04: Settings

Status: done

Settings belong to the user, not an organization, so both functions use
`sessionMiddleware`.

## Acceptance criteria

- [x] `getSettings` creates the row on first call with the browser's time zone
- [x] `updateSettings` (IANA zone validated, week start mon/sun)
- [x] Tested on a seeded throwaway database (`src/server/settings.test.ts`)

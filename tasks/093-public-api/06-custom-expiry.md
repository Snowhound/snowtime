# 06: Custom expiry date

Status: todo (optional; nothing else in task 093 depends on it)

Besides the fixed lifetimes (30 days, 90 days, 1 year, none), a user can pick the date a key
stops working, for example the end of a contract. The key expires at the end of that day in
the user's time zone. A custom date has no upper limit, since a key can already never
expire.

No migration is needed: `api_key.expires_at` already holds any instant, and the list shows it
as it does now.

## Acceptance criteria

- [ ] The Settings prototype (`prototypes/settings.html`) gets a "Custom date" option in
      Expires, which shows a date field under the select, and the user approves it before
      the Solid change
- [ ] `CreateApiKeyInput` accepts `lifetime: 'custom'` with an ISO date `expiresOn`, which it
      requires then and refuses otherwise
- [ ] The server reads the user's time zone from `user_settings` and sets the expiry to the
      start of the next day in that zone (`startOfDay(addDays(expiresOn, 1), zone)` in
      `src/lib/calendar.ts`). It passes the plugin the seconds from now to then
- [ ] `apiKeyOptions` sets `keyExpiration.maxExpiresIn` to `Number.POSITIVE_INFINITY`. The
      plugin refuses any lifetime over it, 365 days by default, and compares it as a plain
      number
- [ ] The earliest date is tomorrow, so the key lasts at least the plugin's `minExpiresIn`
      (1 day). The server refuses today and past dates as `INVALID`, whatever the form
      allowed
- [ ] Around a daylight saving change, a day lasts 23 or 25 hours, so late on the eve of a
      23-hour day the end of tomorrow is under 24 hours away. The server raises the seconds
      it passes to the plugin to at least one day
- [ ] The form uses `DatePicker` (`src/components/date-time/`) with tomorrow as `min`, no
      `max`, and the user's week start. The hint names the day the key stops working, as
      for the fixed lifetimes
- [ ] English and Estonian strings for the option, the field, and the refusals
- [ ] Tests: the expiry falls at the end of the chosen day in the user's zone, including
      across a daylight saving change and at the one-day floor; a date years ahead is
      accepted; today and a past date are refused; the card sends `lifetime: 'custom'` with
      the chosen date
- [ ] `docs/architecture/auth.md` ("API keys") lists the custom date beside the fixed
      lifetimes, and `prototypes/README.md` describes the option

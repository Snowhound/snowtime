# 03: Country setting

Status: todo

The holidays follow the user's country, not their language: someone in Tallinn using the
app in English still has Estonian holidays. Add a Country setting to Preferences. It
lists only the countries with holiday data, so the select stays short and renders on the
server with the page; there's no full country list to load.

Options: "From time zone", Estonia, United States, and Other. "From time zone" maps
`Europe/Tallinn` to Estonia and US zones (`America/New_York`, `America/Chicago`,
`America/Denver`, `America/Los_Angeles`, `America/Anchorage`, `Pacific/Honolulu`, and their
aliases) to the United States; any other zone gives Other. Its label names the guess, for
example "From time zone (Estonia)".

## Acceptance criteria

- [ ] `user_settings.country` is a nullable text column; null means "From time zone"
      (`docs/migrations.md`)
- [ ] The settings schema accepts only `'EE'`, `'US'`, `'other'`, or null
- [ ] Preferences shows the setting with a hint on what it affects, in English and Estonian
- [ ] The select's options render on the server; opening Preferences costs no more than
      before
- [ ] A test covers the guess from the time zone
- [ ] The data model diagram (`datamodel/`) shows the column

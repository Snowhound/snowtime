# 03: Country setting

Status: done

The holidays follow the user's country, not their language: someone in Tallinn using the
app in English still has Estonian holidays. Add a Country setting to Preferences. It
lists only the countries with holiday data, so the select stays short and renders on the
server with the page; there's no full country list to load.

Options: "From time zone", Estonia, United States, and Other. "From time zone" maps
`Europe/Tallinn` to Estonia and the US's zones in tzdata (`zone1970.tab`), with their aliases,
to the United States; any other zone gives Other. The US territories give Other, since their
public holidays differ. Its label names the guess, for example "From time zone (Estonia)".

## Acceptance criteria

- [x] `user_settings.country` is a nullable text column; null means "From time zone"
      (`docs/migrations.md`)
- [x] The settings schema accepts only `'EE'`, `'US'`, `'other'`, or null
- [x] Preferences shows the setting with a hint on what it affects, in English and Estonian
- [x] The select's options render on the server; opening Preferences costs no more than
      before
- [x] A test covers the guess from the time zone
- [x] The data model diagram (`datamodel/`) shows the column

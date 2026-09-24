# 03: Settings

Status: todo

One settings page with preferences saved to the account. Built early because the time
zone, week start, theme, and language it sets drive every later view. Prototype:
`prototypes/settings.html`.

## Acceptance criteria

- [ ] Preferences card: language, time zone (with the device-zone button and the preview),
      week start, theme, timer layout, and show summary; each field saves on change
      through `updateSettings`
- [ ] Changing the language switches the UI language without a reload
- [ ] Profile card: name saved through Better Auth's `updateUser`; email read-only
- [ ] Sign-in methods listed with Connect (`linkSocial`) and Disconnect (`unlinkAccount`,
      confirmed); Disconnect disabled on the last linked method
- [ ] Passkeys: add, list, and remove through the Better Auth passkey client

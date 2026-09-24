# 012: i18n with Paraglide

Status: todo

Paraglide is planned in `docs/architecture.md`. Cheaper to add before UI strings pile up.
English is the default language and Estonian the second. The server side is task 018.

## Acceptance criteria

- [x] Languages decided: English (`en`, default) and Estonian (`et`)
- [ ] Paraglide JS installed and wired into TanStack Start
- [ ] The UI language follows `user_settings.locale` once signed in
- [ ] Error messages come from the `AppError` key, with the server's English text as the
      fallback; every catalog key has an `en` and an `et` message
- [ ] Custom messages in `src/schemas/` come from Paraglide
- [ ] Architecture doc updated from "planned" to the chosen setup

# 012: i18n with Paraglide

Status: done

Paraglide is planned in `docs/architecture.md`. Cheaper to add before UI strings pile up.
English is the default language and Estonian the second. The server side is task 018.

## Acceptance criteria

- [x] Languages decided: English (`en`, default) and Estonian (`et`)
- [x] Paraglide JS installed and wired into TanStack Start
- [x] The UI language follows `user_settings.locale` once signed in (task 023, app frame)
- [x] Error messages come from the `AppError` key, with the server's English text as the
      fallback; every catalog key has an `en` and an `et` message
- [x] Custom messages in the `*.schemas.ts` files come from Paraglide
- [x] Architecture doc updated from "planned" to the chosen setup

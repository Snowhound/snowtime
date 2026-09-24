# 018: Server readiness for i18n

Status: done

The UI will ship in English and Estonian (task 012). The server gets ready first, so no
server function has to change when Paraglide lands: errors carry a stable message key,
and each user's language lives in their settings.

## Acceptance criteria

- [x] Every `AppError` carries a message key from one catalog in `src/server/errors.ts`;
      the English text in the catalog is the fallback message
- [x] The serialization adapter in `src/start.ts` sends the key across the wire
- [x] `user_settings.locale` (`en` or `et`, default `en`) added by an additive migration;
      `schema.ts` and `datamodel/snowtime.dbml` updated; `bun run db:drift` clean
- [x] `getSettings` takes the browser's locale for a new row; `updateSettings` changes it
- [x] `docs/architecture.md` records the split: the server returns keys, dates and
      numbers; the client formats and translates them

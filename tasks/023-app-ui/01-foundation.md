# 01: Foundation

Status: todo

Shared pieces every view needs, set up before the first page so views don't each invent
their own.

## Acceptance criteria

- [ ] Paraglide wired into TanStack Start (task 012), including the locale used for
      server rendering: `user_settings.locale` when signed in, the browser's language
      otherwise
- [ ] The custom messages in `src/schemas/` come from Paraglide (task 012)
- [ ] Solid-UI components added with the CLI for everything `prototypes/ui.js` mirrors
- [ ] The project colors (`--series-1` to `--series-8`, light and dark) and any other
      tokens from `prototypes/prototype.css` moved into `src/styles.css`
- [ ] Lucide icons from `lucide-solid`
- [ ] TanStack Query provider with a pattern for optimistic mutations, using
      client-generated UUIDv7 ids
- [ ] An `AppError` shows its translated message from the error key, with the server's
      English text as the fallback
- [ ] Shared formatters for durations, times, and dates in the user's locale and zone,
      and a TanStack Form helper that runs the shared Valibot schemas
- [ ] Component testing set up (task 014)

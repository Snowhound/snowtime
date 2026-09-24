# 01: Foundation

Status: done

Shared pieces every view needs, set up before the first page so views don't each invent
their own.

## Acceptance criteria

- [x] Paraglide wired into TanStack Start (task 012), including the locale used for
      server rendering: `user_settings.locale` when signed in, the browser's language
      otherwise; the app frame (02) sets the cookie from the settings
- [x] The custom messages in `src/schemas/` come from Paraglide (task 012)
- [x] Solid-UI components for everything `prototypes/ui.js` mirrors, copied from the same
      registry commit (`21ba4fa`), because the CLI (0.7.2) fails installing dependencies
- [x] The project colors (`--series-1` to `--series-8`, light and dark) and any other
      tokens from `prototypes/prototype.css` moved into `src/styles.css`
- [x] Lucide icons from `lucide-solid`
- [x] TanStack Query provider with a pattern for optimistic mutations, using
      client-generated UUIDv7 ids
- [x] An `AppError` shows its translated message from the error key, with the server's
      English text as the fallback
- [x] Shared formatters for durations, times, and dates in the user's locale and zone,
      and a TanStack Form helper that runs the shared Valibot schemas
- [x] Component testing set up (task 014); its first real component test comes with the
      timer (04)

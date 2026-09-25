# 040: Error pages

Status: todo

An unknown path renders an empty page, and an error thrown while loading a route shows
TanStack Router's default "Something went wrong!" with the raw error message (seen on
2026-09-25 during task 039). Both should look like the rest of the app and tell the
reader where to go next. A minimal page is enough.

## Acceptance criteria

- [ ] A not-found page (`notFoundComponent` on the root route, or the router's
      `defaultNotFoundComponent`) for unknown paths, with a link to the timer when
      signed in and to sign-in when signed out; the response status stays 404
- [ ] An error page (`errorComponent` or `defaultErrorComponent`) for errors thrown in
      loaders, `beforeLoad`, and rendering, with a retry and a way home. It shows the
      `AppError` message through `errorMessage` (`src/lib/errors.ts`) and a generic
      message for anything else, never a raw stack or server message in production
- [ ] Both pages use the auth layout (`src/features/auth/auth-layout.tsx`) or the app
      frame, follow the theme and seasonal scene settings, and are translated in
      English and Estonian
- [ ] A loader's `NOT_FOUND` for a missing record, if a route has one, shows the
      not-found page rather than the error page
- [ ] Component tests cover both pages, and a browser check covers a 404 and a thrown
      error signed in and signed out

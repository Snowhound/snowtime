# 02: App frame and sign-in

Status: todo

The signed-in layout every page shares, and the signed-out screens that lead into it.
Prototypes: `prototypes/app-frame.js` and `prototypes/auth.html` (01 · Card).

## Acceptance criteria

- [ ] A signed-in layout route that sends signed-out users to sign-in and returns them to
      the page they asked for
- [ ] Header: organization switcher (sets the active organization in the session),
      navigation (Timer, Reports, Projects, and Organization for admins and owners), and
      user menu (Profile, Settings, theme, Sign out); navigation moves to a second row
      below 768 px
- [ ] The server renders the theme class from `user_settings`, so the first paint has
      no flash; signed-out pages follow the system theme (`docs/architecture.md`, "User
      settings")
- [ ] Sign in shows only the methods `getSignInMethods` returns (task 022): the configured
      providers, passkey, and the password form in local development only
- [ ] Accept invitation, wrong-account, and expired-invitation screens
- [ ] Create organization for a signed-in user with no organization or invitation, with
      the short name derived from the name until edited
- [ ] The TanStack welcome page (`src/routes/index.tsx`) replaced by a redirect to
      the timer or sign-in

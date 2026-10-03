# 02: Device sign-in

Status: cancelled

Cancelled by Kait and the user on 2026-10-03: the device authorization grant needs Better
Auth's OAuth device authorization with registered applications and their client ids to
maintain, which is out of scope while task 081 moves the backend to Rust. API keys
(subtask 01) serve the clients for now; device sign-in can come later beside them. The
criteria below were never started.

A client outside the browser signs in with the device authorization grant: it shows a short
code and opens Snowtime, where the signed-in user approves it, and it gets a token for
`/api/v1` (subtask 03). Settings lists the apps a user has connected, so they can sign one
out.

## Acceptance criteria

- [ ] Two screens are prototyped before any Solid code, following `prototypes/README.md`
      ("Workflow"):
  - the approval page at `/device`: enter or confirm the code, then see which app asks
    (its display name) and for what access (read only, or read and write), with Approve
    and Deny. Signed out, it sends the user to sign in and back, with the code kept.
    Fixtures for a code from the link, a code typed in, a wrong or expired code, approved,
    and denied;
  - a "Connected apps" card in `prototypes/settings.html`: each app's name, access, when it
    was connected, and when it was last used, with Sign out, which asks for confirmation.
    Fixtures for no apps, several, and a long name
- [ ] Both pass the checks in `docs/skills/ui-review/SKILL.md` at 1440, 850, and 390 px, in
      light and dark themes, and `prototypes/README.md` has reference entries for them
- [ ] The user approves the prototypes before they are built in Solid
- [ ] `deviceAuthorization()` from `better-auth/plugins` is enabled in
      `src/server/auth/better-auth.server.ts` before `tanstackStartCookies()`, with
      `verificationUri` at `/device`. The `bearer` plugin stays off
- [ ] `validateClient` accepts only the client ids in the server's list, each with a display
      name; the Raycast extension is the first entry
- [ ] The approved device code's scope and client id are copied onto the session it
      becomes (`session.scope`, `session.client_id`)
- [ ] A hand-written migration adds the plugin's `device_code` table, and the session
      columns, per `docs/migrations.md`; `src/db/schema.ts` and the DBML in `datamodel/`
      match (`bun run db:drift`, `bun run datamodel:generate`)
- [ ] `device` joins the reserved slugs in `src/lib/app-paths.ts`, so no organization can
      take the page's path
- [ ] The device endpoints work for a client that sends no `Origin` header or cookie:
      `/device/code` and `/device/token` from a script, checked against Better Auth's
      origin check and its per-IP rate limit, which counts the polling
- [ ] The `/device` page and the Connected apps card are built from the approved
      prototypes, in English and Estonian. Signing an app out deletes its session
- [ ] Tests against seeded databases: an unknown client id is refused; an approved code
      gives a token whose session carries the scope and client id; a denied or expired code
      gives none; the Connected apps list shows only the user's own device sessions; signing
      one out ends it
- [ ] `docs/architecture/auth.md` gets a "Device sign-in" section: the flow, what the token
      is, where it reaches and why, scopes, the client list, lifetime, and signing out.
      The privacy policy (`src/features/legal/privacy-page.tsx`) names connected apps
      among the sessions it lists

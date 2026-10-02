# 05: Raycast extension

Status: todo

A Raycast extension for the timer, in its own repository. It signs in with the device
grant (subtask 02) and uses only the `/api/v1` endpoints from subtask 04, so it tests the
public contract the way any other client would. This task tracks it here until it has an
issue tracker of its own.

## Acceptance criteria

- [ ] A new repository under the Snowhound organization, linked from `docs/api.md`
- [ ] Preferences: the instance URL (default: production)
- [ ] Sign in: the extension asks for a device code with its client id and
      `scope=read write`, shows the user code, opens the verification page, and polls at
      the interval the server gives until the code is approved, denied, or expired. The
      token goes in Raycast's `LocalStorage`, which Raycast encrypts
- [ ] Organization picker from `GET /api/v1/me`, remembered between runs
- [ ] Commands: Start timer (description, ticket, and project), Stop timer, and Recent
      entries, which can start an entry again
- [ ] A menu bar item that shows the running timer and its elapsed time, counted on the
      client, as `docs/architecture/data.md` asks, and that stops it
- [ ] A `401` drops the token and offers to sign in again, since the session expired or
      was signed out in Settings; a `403` says which access is missing
- [ ] Works against a self-hosted instance at any URL
- [ ] Ready to submit to the Raycast Store through `raycast/extensions`; submitting is a
      follow-up

# 094: Edit and delete entries with an API key

Status: todo

Open `PATCH` and `DELETE /api/v1/organizations/:organizationId/entries/:id` to API keys,
so the Raycast extension can edit the running timer and past entries, and delete entries
(snowtime-raycast tasks 012, 013, and 014). Both routes, with `updateEntry` and
`deleteEntry`, already serve the web app. Marking them `keys` makes them `write` calls, as
every non-`GET` route is (`src/server/http.server.ts`).

## Initial ideas

- Open the general entry calls rather than running-timer-only ones such as
  `PATCH /api/v1/timer`. They are two marked routes and no new server code, and they cover
  the running timer and past entries alike. A timer-only call would need new server code
  that looks up the organization from the entry.
- Widening `write` from "starting and stopping timers" to "and editing and deleting
  entries" reaches keys that already exist. `/api/v1` changes only by adding, and a
  `write` key already acts as its user, so this proposal accepts it rather than adding a
  third scope. Deleting is the first call a leaked `write` key can use to destroy data.
  The delete is logical (`sys_deleted`), so an operator can restore a row, which is why
  this proposal still accepts it.
- `updateEntry` refuses `stoppedAt` on a running entry, so a key can't stop a timer
  through the edit call and bypass `POST /api/v1/timer/stop`.
- `deleteEntry` deletes a running entry too, which discards the timer: `GET /api/v1/timer`
  then answers `null`. Raycast's Discard Timer relies on this, so `docs/api.md` states it.
- The delete answers `{ "id": entryId }`. A second delete of the same id answers 404
  `entry_not_found`, so a client that retries treats that 404 as done.
- Open: a guard for a client that edits what it believes is the running timer, such as an
  optional `running: true` that answers `409` once the entry has stopped. Without it, the
  client reads `stoppedAt` in the answer, which is enough for Raycast. Recommendation:
  leave it out until a client needs it.
- Open: an admin's or owner's key can edit and delete other members' entries, as the web
  app lets them (`assertCanWrite`). Raycast changes only the user's own entries, so the
  calls could refuse a key on another user's entry. Recommendation: keep the web app's
  rule, because a key acts as its user everywhere else.
- Creating finished entries (`POST /entries`) stays closed to keys; no client asks for it
  yet.

## Acceptance criteria

- [ ] The entries `PATCH` and `DELETE` routes are marked `keys`, and a `read` key gets 403
      `FORBIDDEN` on both
- [ ] `docs/api.md` lists both calls in "Endpoints" and documents their fields, answers,
      and refusals: `entry_not_found`, `entry_forbidden`, and for the edit
      `entry_running`, `entry_end_before_start`, `entry_too_long`, `entry_limit`,
      `project_not_found`, and `project_archived`
- [ ] `docs/api.md` says that deleting the running entry discards the timer
- [ ] The "Scopes" table says `write` also edits and deletes entries
- [ ] `bruno/` has Edit entry and Delete entry requests, with their Docs tabs. Delete
      entry runs last and deletes the entry Start timer made, so a collection run no
      longer leaves one behind
- [ ] Tests cover a key editing and deleting its own entry, the running one included, a
      member's key on another user's entry, and a `read` key

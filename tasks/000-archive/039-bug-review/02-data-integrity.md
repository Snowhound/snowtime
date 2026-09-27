# 02: Data integrity

Status: done

Server checks that read and then write can race, as the 24-hour entry bug showed. Rules
that must always hold belong in the database; caps can stay approximate
(`docs/architecture.md`, "Limits").

## Acceptance criteria

- [x] Each check-then-write in `src/server/` is listed with what a concurrent write can
      break, and each invariant is enforced by a constraint, trigger, transaction, or
      conditional write
- [x] One running timer per user holds across organizations, including when a member is
      removed while their timer runs
- [x] Soft-deleted rows never count in unique indexes, caps, lists, or reports, and
      references to them (archived or deleted projects, deleted teams) behave as
      documented
- [x] Composite foreign keys keep entries, projects, and teams in one organization
- [x] Each migration in `drizzle/` stays backward compatible with the previous app
      version (`docs/migrations.md`), and `schema.ts` matches it, including partial
      index `WHERE` clauses the drift check can't see

## Findings

Reviewed on 2026-09-25. Races were reproduced with `interleaved` (`src/server/testing.ts`),
which runs another request's write in the gap before a chosen statement. Two real
connections to one file don't reproduce them reliably, because of task 043.

### Fixed

- An entry could land on a deleted project. `createEntry` and `updateEntry` check the
  project, then write in a separate statement; a `deleteProject` in between left a live
  entry pointing at a deleted project, which then showed with no name. Triggers now refuse
  the write (`time_entry_live_project`, on insert and on a change of project), and
  `project_deleted_with_entries` refuses deleting a project that has live entries. The
  server maps them to `project_not_found` and `project_has_entries`. Tests are in
  `entries.test.ts` and `projects.test.ts`, and migration `20260925131804` adds the
  triggers.
- A timer could start in an organization the user had just left. The middleware resolves
  the scope, Better Auth removes the member, and its hook stops their timer; then
  `startTimer` inserts a new running entry there. That entry blocks every later timer
  (`timer_running_in_left_organization`), and the user can't stop it. `startTimer` now
  checks membership again inside its transaction (`timer.test.ts`).
- `docs/architecture.md` said the `updated_at` trigger was the only trigger allowed,
  which stopped being true with `time_entry_max_length`. "Application rules" now allows
  guard triggers for rules a race can break, and "Data conventions" and "Tenancy" record
  the new rules.

### Deferred

- Task 043: after a `SQLITE_BUSY`, `@libsql/client` 0.18 with a `file:` URL holds back
  later writes on that connection, and other connections never see them. This affects
  local development and tests only.

### Check-then-write list

Each check below reads, then writes in a later statement. The second column says what a
concurrent write can break.

| Where                                                                 | What a concurrent write can break                                  | Held by                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `updateEntry` start/end checks                                        | an entry over 24 hours, or ending before it starts                 | triggers `time_entry_max_length`, `CHECK time_entry_stopped_after_started`                              |
| `createEntry`/`updateEntry` project check                             | an entry on a deleted project                                      | triggers `time_entry_live_project` (fixed)                                                              |
| `deleteProject` entry check                                           | a deleted project with live entries                                | its transaction, and trigger `project_deleted_with_entries` (fixed)                                     |
| `startTimer` membership (scope)                                       | a running timer in a left organization                             | membership check in its transaction (fixed)                                                             |
| `startTimer` running check                                            | two running timers                                                 | partial unique index `time_entry_one_running`                                                           |
| `stopTimer`, `stopTimerOfRemovedMember`                               | none: one conditional `UPDATE`                                     | the statement                                                                                           |
| Entry and project caps (`assertEntryRoom`, `createProject`)           | a cap exceeded by one                                              | accepted: caps are bounds ("Abuse limits")                                                              |
| Project names, entry and project ids                                  | duplicates                                                         | unique indexes, mapped to `CONFLICT`                                                                    |
| `createEntry` for another member                                      | an entry for someone removed a moment before                       | accepted: removed members keep their entries anyway                                                     |
| `assertUsableProject` vs. archiving                                   | time logged on a project archived at the same moment               | accepted: archiving is lifecycle, and the entry predates it                                             |
| `assignProjectToTeam` vs. `deleteProject`                             | a `project_team` row for a deleted project, which nothing reads    | accepted                                                                                                |
| `assignProjectToTeam` vs. deleting the team                           | a foreign key error (500) instead of `team_not_found`              | accepted: composite foreign key keeps the data right                                                    |
| `setTeamRole`, `deleteEntry`, `updateProject`, `setArchived`          | none: the write repeats the check in its `WHERE`                   | the statement                                                                                           |
| `getSettings` first call                                              | two rows                                                           | primary key and `onConflictDoNothing`                                                                   |
| Any write vs. a role change                                           | one last write with the old role, within one request               | accepted                                                                                                |
| Better Auth accept-invitation (no transactions: `transaction: false`) | `team_member` rows without a `member` row, if `createMember` fails | accepted: only on a database error. The invitation claim is conditional, and the limit is checked first |

### Checked and sound

- One running timer: the partial unique index spans organizations. `createEntry` can't
  create a running entry, and `updateEntry` can't restart one. Deleting a running entry
  frees the index. The removal hook stops the timer on remove-member and leave, which
  subtask 01 confirmed in the Better Auth source.
- Soft delete:
  - Unique indexes: the project name and running-timer indexes are partial on
    `sys_deleted = 0`.
  - Caps count only live rows; the project cap counts archived ones.
  - Lists, reports, `getRunningTimer`, and `getFirstEntryStart` filter through `live()`
    or `notDeleted()`.
  - A deleted project is not found by update, archive, or assign.
- References:
  - Archived projects keep their entries and names: the client always lists them with
    `includeArchived`.
  - A deleted team cascades its `project_team` and `team_member` rows. It sets
    `invitation.team_id` and `session.active_team_id` to null.
- Composite foreign keys: `time_entry` to `project`, and `project_team` to both `project`
  and `team`, are on `(id, organization_id)`. `@libsql/client` turns foreign keys on, and
  the dev database passes `PRAGMA foreign_key_check`. `schema.test.ts` now also covers a
  cross-organization `project_team`.
- Migrations: all are additive. That is columns with defaults, one index, a data update
  the old app reads as before, and triggers. The old app's checks match the new triggers,
  so it meets them only in a race. `schema.ts` matches the two partial `WHERE` clauses and
  every named `CHECK`.

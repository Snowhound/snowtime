# 04: Endpoints

Status: done

Since the replay onto main's routes per domain, these endpoints are the routes marked
`keys` in the domains' `*.routes.ts`, at task 084's paths (README, and `docs/api.md`).

The first six endpoints: what the Raycast extension needs. Each is a server route in
`src/routes/api/v1/` that goes through the helper from subtask 03 and calls an existing
rule in `src/server/<domain>/*.server.ts`. The endpoints themselves are in
`src/server/api/endpoints.server.ts`, so tests run them against seeded databases, and the
route files only map a method to one.

| Method and path                    | Scope   | Rule                   |
| ---------------------------------- | ------- | ---------------------- |
| `GET /api/v1/me`                   | `read`  | user and organizations |
| `GET /api/v1/timer`                | `read`  | `getRunningTimer`      |
| `POST /api/v1/orgs/:orgId/timer`   | `write` | `startTimer`           |
| `POST /api/v1/timer/:entryId/stop` | `write` | `stopTimer`            |
| `GET /api/v1/orgs/:orgId/projects` | `read`  | `listProjects`         |
| `GET /api/v1/orgs/:orgId/entries`  | `read`  | `listEntries`          |

A user has at most one running timer across all their organizations
(`time_entry_one_running`), so the timer endpoints name the running entry, not a list.

## Acceptance criteria

- [x] `src/server/api/v1.server.ts` creates the app's `apiRoute` with `createApiRoute`: `db`,
      `auth.api.verifyApiKey` with the key as its body, `rateLimitStore`, and
      `env.ALLOWED_LOGIN_DOMAINS`
- [x] `GET /api/v1/me` returns the user's id, name, and email, and their organizations
      with id, name, slug, and role. It reuses `appSession`'s reads, not `getAppSession`,
      which sets cookies and the active organization
- [x] `POST /api/v1/orgs/:orgId/timer` takes `StartTimerInput` (`id`, `description`,
      `ticket`, `projectId`) and returns `started` and `stopped`. The client generates `id`
      as a UUID v7, so a retried request answers 409 `entry_id_taken` instead of starting a
      second entry
- [x] `POST /api/v1/timer/:entryId/stop` stops the running timer only if it is that entry,
      and answers 404 `timer_not_running` otherwise, leaving a newer timer running
- [x] `GET /api/v1/orgs/:orgId/entries` takes `ListEntriesInput` (`from`, `to`, and an
      optional `userId`) as query parameters, so its `MAX_LIST_DAYS` cap applies
- [x] Responses are plain JSON: timestamps as ISO 8601 strings in UTC, no Start
      serialization
- [x] Each endpoint is in `docs/api.md` with its parameters, a sample response, and the
      errors it can return
- [x] Tests for each endpoint against seeded databases, including stopping a timer that
      another one has replaced, and a team member reading entries the web app would hide
      from them
- [x] Knip and oxlint pass; the route files only wire the route, as `AGENTS.md` asks

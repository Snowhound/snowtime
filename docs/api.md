# HTTP API

Snowtime's HTTP API lets clients outside the browser, such as a Raycast extension or a
script, use the timer. This page is the contract: clients may rely on everything it states.

## Base URL

`https://<instance>/api/v1`, where `<instance>` is the host the Snowtime web app runs on.

## Signing in

Every request sends a personal API key:

```http
Authorization: Bearer snow_...
```

A user creates keys in Settings, under API keys. A key acts as its user in every
organization they belong to, and stops working when it expires, when the user revokes it,
or when the instance's allowed login domains no longer include the user's address.

The API ignores cookies and sets none, and sends no CORS headers, so a web page on another
origin can't call it. A key doesn't work anywhere outside `/api/v1`.

## Scopes

A key has one of two scopes, chosen when it is created:

| Scope   | Allows                                                      |
| ------- | ----------------------------------------------------------- |
| `read`  | Reading the user, their organizations, timer, and entries   |
| `write` | Everything `read` allows, plus starting and stopping timers |

A request outside its key's scope answers 403 `FORBIDDEN`.

## Errors

A failed request answers a JSON body with a code and an English message:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "API key is read-only."
  }
}
```

Clients branch on the HTTP status and `code`; the message is for people and may change.
Messages from input validation follow `Accept-Language`, as in the web app (English or
Estonian); the others are always English.

| Status | `code`            | Meaning                                                         |
| ------ | ----------------- | --------------------------------------------------------------- |
| 401    | `UNAUTHENTICATED` | No key, or a key that is unknown, revoked, or expired           |
| 403    | `FORBIDDEN`       | The key lacks the scope, or the user isn't in the organization  |
| 404    | `NOT_FOUND`       | The resource doesn't exist, or the user can't see it            |
| 409    | `CONFLICT`        | The request clashes with the current state, such as a reused id |
| 422    | `INVALID`         | The input fails validation; the message names the first problem |
| 422    | `LIMIT_REACHED`   | A cap on stored data, such as entries per day                   |
| 429    | `RATE_LIMITED`    | Too many requests; `Retry-After` gives the seconds to wait      |
| 500    | `INTERNAL`        | An unexpected error; the body has no details                    |
| 503    | `UNAVAILABLE`     | The database is unreachable, for example during maintenance     |

A `GET` takes its input as query parameters; other methods take a JSON body.

## Rate limits

Two limits apply, and each answers 429 with `Retry-After`:

- Each key may send 60 requests in a row with gaps under 5 seconds. A longer gap restarts
  the count, so a client that polls every 5 seconds or slower never reaches it.
- A user's writes, from the web app and from every key together, are limited to 120 a
  minute.

## Responses

Responses are JSON with `Cache-Control: no-store`. Timestamps are ISO 8601 strings in UTC,
such as `2026-10-03T09:30:00.000Z`.

## Versioning

`/api/v1` changes only by adding: new endpoints, new optional input fields, and new response
fields. A field never changes its meaning or type, so clients must ignore fields they don't
know. A change that breaks this goes in `/api/v2`, beside `/api/v1`.

## Trying the API

`bruno/` holds a [Bruno](https://www.usebruno.com) collection with a request for every
endpoint. Each request's Docs tab says what it does and what it saves for the next one.

1. In Bruno, open the `bruno/` folder as a collection.
2. Pick the **Local** environment for `bun run dev`, or **Instance** for a deployment, and
   set that environment's `baseUrl`.
3. In Snowtime, create an API key under Settings → API keys, and paste it into the
   environment's `apiKey`. Bruno stores secret variables on your machine, not in the
   collection's files, so the key stays out of git. A `read` key runs the `GET` requests;
   starting and stopping a timer need a `write` key.
4. Run **Me**. It saves your first organization's id as `orgId`, which the requests in an
   organization use. Set `orgId` yourself to act in another one.

**Start timer** and **Running timer** save the entry's id as `entryId`, which **Stop timer**
stops. **Start timer again** resends the last start, and answers 409, as a retry should.

The Bruno CLI runs the whole collection in order and checks each answer's status:

```sh
cd bruno && bru run --env Local --env-var apiKey=snow_...
```

Install it with `bun add -g @usebruno/cli`. The run needs a `write` key, and it leaves an
entry behind: **Start timer** stops the user's running timer and starts one, which **Stop
timer** then stops. Use a seeded user without a running timer, such as Noah.

Change the collection with the API: a new or changed endpoint updates its request, and
its Docs tab, in the same change as this page.

## Endpoints

| Method and path                    | Scope   | Answers                                     |
| ---------------------------------- | ------- | ------------------------------------------- |
| `GET /api/v1/me`                   | `read`  | The user and their organizations            |
| `GET /api/v1/timer`                | `read`  | The running timer, in any organization      |
| `POST /api/v1/orgs/:orgId/timer`   | `write` | Starts a timer in the organization          |
| `POST /api/v1/timer/:entryId/stop` | `write` | Stops the running timer if it is that entry |
| `GET /api/v1/orgs/:orgId/projects` | `read`  | The organization's active projects          |
| `GET /api/v1/orgs/:orgId/entries`  | `read`  | Entries in a time range                     |

Every path with `:orgId` answers 403 `FORBIDDEN` when the user isn't a member of that
organization.

### Entries

Entries share one shape in every answer. A running entry has `stoppedAt: null`.

```json
{
  "id": "01920000-0000-7000-8000-000000000501",
  "organizationId": "01920000-0000-7000-8000-000000000201",
  "userId": "01920000-0000-7000-8000-000000000104",
  "projectId": "01920000-0000-7000-8000-000000000401",
  "description": "Landing page",
  "ticket": "WEB-12",
  "startedAt": "2026-10-03T07:05:03.642Z",
  "stoppedAt": null
}
```

`projectId` and `ticket` can be null. An entry lasts at most 24 hours; a timer left
running longer stops at 24 hours when it is stopped.

### `GET /api/v1/me`

```json
{
  "user": { "id": "01920000-…", "name": "Max Member", "email": "max@example.com" },
  "organizations": [
    { "id": "01920000-…", "name": "Northwind Studio", "slug": "northwind", "role": "member" }
  ]
}
```

`role` is `owner`, `admin`, or `member`. Organizations are sorted by name.

### `GET /api/v1/timer`

A user has at most one running timer across all their organizations. The answer is
`{ "timer": null }` without one, or the entry with its project:

```json
{
  "timer": {
    "id": "01920000-…",
    "…": "the other entry fields",
    "stoppedAt": null,
    "project": { "id": "01920000-…", "name": "Website redesign", "color": "#3b82b8" }
  }
}
```

`project` is null for an entry without one, and `color` can be null.

### `POST /api/v1/orgs/:orgId/timer`

Starts a timer, and stops the running one first, in whichever organization it runs.

| Field         | Type           | Notes                                                                    |
| ------------- | -------------- | ------------------------------------------------------------------------ |
| `id`          | UUID v7        | Required. The client generates it, so a retry can't start a second timer |
| `description` | string         | Optional, at most 500 characters; defaults to empty                      |
| `ticket`      | string or null | Optional; a ticket key such as `WEB-12`                                  |
| `projectId`   | UUID or null   | Optional; an active project in the organization                          |

```json
{ "started": { "…": "the new entry" }, "stopped": { "…": "the entry it stopped" } }
```

`stopped` is null when no timer was running.

| Status | When                                                                    |
| ------ | ----------------------------------------------------------------------- |
| 404    | The project doesn't exist, or the user can't see it                     |
| 409    | An entry with this `id` exists, which is how a retried request ends     |
| 409    | The project is archived, or another timer started at the same moment    |
| 422    | The input is invalid, or the user has too many entries around this time |

### `POST /api/v1/timer/:entryId/stop`

Stops the running timer if it is the entry in the path, and answers `{ "stopped": entry }`.
Naming the entry keeps a late or retried stop from ending a timer started since. If that
entry isn't the running timer, the request answers 404, and a newer timer keeps running.
The request takes no body.

### `GET /api/v1/orgs/:orgId/projects`

```json
{ "projects": [{ "id": "01920000-…", "name": "Website redesign", "color": "#3b82b8" }] }
```

The organization's active projects the user can see, sorted by name. `color` can be null.

### `GET /api/v1/orgs/:orgId/entries`

Entries that overlap a range, newest first, as `{ "entries": [entry, …] }`.

| Parameter | Notes                                                                     |
| --------- | ------------------------------------------------------------------------- |
| `from`    | Required, ISO 8601, such as `2026-10-01T00:00:00Z`; the range includes it |
| `to`      | Required, ISO 8601, after `from`; the range ends before it                |
| `userId`  | Optional; one member's entries                                            |

The range spans at most 93 days. An admin or owner reads everyone's entries, a team lead
their own and their team members', and anyone else only their own. Without `userId`, the
answer holds all the entries the user may read. With the `userId` of a member the user
may not read, the request answers 403.

# HTTP API

Snowtime's HTTP API lets clients outside the browser, such as a Raycast extension or a
script, use the timer. This page is the contract: clients may rely on everything it states.
The endpoints are planned (task 082, subtask 04); the rules below already hold for every
route.

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
    "message": "This API key can only read. Create a key with write access."
  }
}
```

Clients branch on the HTTP status and `code`; the message is for people and may change.

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

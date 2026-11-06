# 097: Calendar integration

Status: in-progress

A user connects their Google Calendar, sees its events beside their time on the Timer page,
and logs meetings as entries: one at a time, a day or a range at once, or automatically
once a meeting starts. A recurring series can carry a project, so its meetings log to that
project. The model is Toggl Track's ([Managing calendar events][toggl]), which a Snowhound
user asked for on 2026-11-02.

The first release supports Google only. The data model, the server code, and the API are
provider-neutral, so Outlook or an iCal feed later adds an adapter and no schema change.

## Subtasks

| #   | Subtask                                                    | Depends on |
| --- | ---------------------------------------------------------- | ---------- |
| 01  | [Prototype](01-prototype.md)                               | —          |
| 02  | [Connect a calendar and log events](02-connect-and-log.md) | 01         |
| 03  | [A project per series](03-series-projects.md)              | 02         |
| 04  | [Auto-track](04-auto-track.md)                             | 03         |
| 05  | [Google verification](05-google-verification.md)           | 02         |

The prototype comes first and is approved before any build: the views matter more than the
mechanics, and the build follows the approved design. Subtasks 02 to 04 each ship on their
own, and each can be tried locally with the Google OAuth client's test users. Subtask 05
opens the integration to users outside the test list.

## Decisions

Decided on 2026-11-02; the data model and tokens on 2026-11-03.

- **Toggl's model.** Events show in the week calendar as planned blocks; a click logs one.
  Auto-track is a switch per calendar, logs an event once it has started for its full
  scheduled length, and runs when the user opens Snowtime, not on a schedule. Rejected:
  Harvest's picker drawer as the main view, and Everhour's entries without a project.
- **Events are read, not stored.** The server fetches events from the provider for the
  range the browser shows and passes them through; the browser caches them per week, as
  it caches entries. Snowtime keeps only what it needs to act: which calendars the user
  picked, series rules, and on each logged entry the key of its event. No background job
  reads calendars, which suits Vercel Functions and Turso's row quotas (`docs/hosting.md`).
- **One organization per calendar for auto-track.** Entries and projects belong to an
  organization, but a calendar belongs to a user. A calendar auto-tracks into at most one
  organization, so a meeting is never logged twice.
- **Auto-track starts when switched on.** It logs events that start after the switch, at
  most 14 days back, so switching it on never adds a month of meetings. Older meetings are
  logged by hand from a range (subtask 02).
- **The running timer is left alone.** A logged meeting that overlaps the running timer
  doesn't stop or move it; the overlap is shown, and the user decides.
- **Unanswered invitations count.** Auto-track skips declined events but logs those the
  user never answered, since people often attend without accepting.
- **Logging depends on opening Snowtime.** A team lead's report shows a member's meetings
  once the member has opened Snowtime since they started. A daily job that fills in
  yesterday can close this gap later; it is out of scope here.
- **Google only, provider-neutral underneath** (see below).

## Provider-neutral design

### Server

`src/server/calendar/` holds the domain. Rules work on one event shape, and each provider
is an adapter that maps its API to it (`src/server/calendar/providers/google.server.ts`).
The adapter lists calendars, lists events in a range, refreshes and revokes tokens, and
builds the keys below. Nothing outside the adapter knows Google's field names.

```ts
interface CalendarEvent {
  key: string // the occurrence, stable across edits: see "Keys"
  seriesKey: string | null // the recurring series it belongs to
  sourceId: string // calendar_source.id
  title: string
  startedAt: number // epoch ms
  stoppedAt: number
  allDay: boolean
  free: boolean // shown as free, not busy
  response: 'organizer' | 'accepted' | 'tentative' | 'none' | 'declined'
  kind: 'event' | 'out_of_office' | 'working_location' | 'focus_time'
}
```

The Google adapter calls the Calendar REST API v3 with `fetch` (`calendarList.list`, and
`events.list` with `singleEvents=true` so a series arrives as its occurrences) and asks
only for the fields above. No Google client library.

### Keys

A key is an opaque string the adapter builds from the provider's stable ids, with the
provider and calendar in it: `google:<calendarId>:<eventId>` for an occurrence, and
`google:<calendarId>:<recurringEventId>` for its series. A key outlives the connection, so
disconnecting and reconnecting a calendar keeps what was logged and deleted.

### Data model

Follows `docs/architecture/data.md` and `docs/migrations.md`. Subtask 02 adds the first two tables and the entry column, subtask 03 the rules.

| Table or column             | Holds                                                                                                                                                                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendar_connection`       | A user's link to a provider account: `user_id`, `provider` (`google`), the provider's account id and email, encrypted access and refresh tokens, their expiry and scope, and `status` (`connected` or `reconnect`). Unique per user, provider, and account.                                               |
| `calendar_source`           | A calendar of a connection: its provider id, name, and color; `shown`; `auto_track_organization_id` (null when off) and `auto_track_since`. One column for the organization is what keeps a calendar auto-tracking into one organization.                                                                 |
| `calendar_series_rule`      | Per organization and user, a series key, its `project_id`, whether auto-track logs it, and the series' last seen title for listing in Settings.                                                                                                                                                           |
| `time_entry.calendar_event` | The key of the event the entry was logged from, or null; for an all-day event logged as a day, the event's key plus `:<date>`. A partial unique index on (`user_id`, `calendar_event`) where it isn't null covers deleted rows too, so a meeting is logged once per user and a deleted one stays deleted. |

Disconnecting deletes the connection, its tokens, and its sources physically and revokes
the token at the provider. Entries keep their `calendar_event`, which references no table.

### Tokens

Calendar access is its own connection with its own OAuth flow, not a Better Auth account
link with extra scopes. Reasons:

- The calendar's Google account can differ from the one the user signs in with, such as a
  work calendar for a user who signs in with GitHub. Better Auth links a provider only
  when its email matches (`docs/architecture/auth.md`), and a linked account becomes a way
  to sign in, which a calendar connection shouldn't be.
- Sign-in keeps its minimal scopes, so Google's verification of the calendar scope
  (subtask 05) can't affect signing in.
- Outlook later is the same table with another `provider`.

The flow reuses the Google OAuth client of sign-in with its own redirect URL, asks for
`calendar.calendarlist.readonly` and `calendar.events.readonly` with offline access, and
stores the tokens encrypted with a key derived from `BETTER_AUTH_SECRET`. Rotating that
secret then asks users to reconnect. Rejected: Better Auth's `linkSocial` with extra
scopes, for the reasons above.

### API

App-only calls, not opened to API keys, under `src/server/calendar/calendar.routes.ts`, with
the client module `src/lib/api/calendar.ts` and conformance tests, per `AGENTS.md`. Route
names carry no provider. snowtime-native ports them later in its own work, never in the
same change or session.

## Acceptance criteria

- [ ] Subtasks 01 to 05 are done
- [x] `docs/product.md` lists the calendar integration in scope and Google as its only
      provider
- [ ] `docs/architecture/calendar.md` records the decisions above, with the proposed ones
      settled, and `docs/architecture/README.md` links it
- [x] The privacy page says what Snowtime reads from a connected calendar, that it stores
      no events, and how to disconnect

[toggl]: https://docs.toggl.com/managing-calendar-events

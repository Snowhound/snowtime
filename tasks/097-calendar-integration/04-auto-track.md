# 097.04: Auto-track

Status: todo

A calendar's Auto-track switch logs its meetings as they start, for their full scheduled
length, in the organization the user picks, without the user entering each one. Logging
runs when the user opens Snowtime or returns to it, as in Toggl.

## Initial ideas

- **The call.** `POST /calendar/sync`, a user route like the timer's, since a user's
  calendars can auto-track into different organizations. For each source with auto-track
  on, it reads events from the later of `auto_track_since` and 14 days ago up to now, and
  logs those that have started, have no entry under their key (deleted ones included), and
  pass the rules below. It checks the user is still a member of the source's organization
  and skips it otherwise. It answers the entries it created.
- **When.** The app frame calls it on load of an organization's page and when the tab
  regains focus, at most once in 5 minutes per tab. The unique key makes concurrent calls
  from two tabs or devices safe: one inserts, the other skips.
- **What it logs.** Not declined, not free, not all-day, not out of office, working
  location, or focus time, and not a series whose rule turns auto-track off. Unanswered
  invitations are logged. Project from the series rule, else none; the same-description
  suggestion of subtask 03 isn't applied unattended.
- **What it saves.** One `createEntries` per organization, so the status line shows
  "Logged 3 meetings" with one Undo. The daily entry limit and the write rate limit apply;
  over a limit it logs what fits and stops quietly until the next call.
- **After logging,** the entry is the user's. A later change to the event in the calendar
  doesn't touch it, and a deleted entry isn't logged again. An event cancelled before it
  starts is never logged.
- **The running timer** is left as it is, and an overlap is shown as the design of
  subtask 01 does.
- **Switching on** sets `auto_track_since` to now and asks for the organization when the
  user has several; choosing another organization moves the switch. Switching off stops
  logging and changes no entry.

## Acceptance criteria

- [ ] Settings switches auto-track per calendar, with its organization
- [ ] Opening Snowtime logs started, unlogged meetings since the switch, at most 14 days
      back, into the source's organization, with the rule's project
- [ ] A meeting under way logs ending at its scheduled end
- [ ] Declined, free, all-day, out-of-office, working-location, and focus-time events, and
      series turned off by a rule, aren't logged; unanswered invitations are
- [ ] A deleted auto-logged entry isn't logged again
- [ ] Two tabs syncing at once log each meeting once
- [ ] A user removed from the organization gets no entries in it
- [ ] The status line shows what was logged with one Undo
- [ ] The running timer is untouched by a sync
- [ ] Tests cover the window, each skip rule, idempotency, the membership check, and the
      entry limit

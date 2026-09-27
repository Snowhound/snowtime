# 060: Ticket keys on entries

Status: done

Descriptions often start with an issue key such as `NBW-412`. An entry gets one ticket key
of its own, shown as a chip and found when a description is committed. The design is in
`prototypes/timer.html` and `organization.html` (`prototypes/README.md`, "Ticket keys"),
decided on 2026-09-27. The company seed (`bun run db:seed --company`) has descriptions with
keys at the start, in brackets, mid-sentence, a second key, and `Q3-2026`.

## Decisions

- One ticket per entry, so reports by ticket add up to the total and match tracker
  worklogs, which belong to one issue each. A key at the start replaces the ticket; a key
  later in the text becomes it only when there is none; other keys stay text.
- A chip's × turns its key back into text, which isn't found again. A key mid-sentence stays
  in the text.
- The ticket shows after the description, so the text never moves: at the end of the
  description's cell at the standard width (changed on 2026-09-27 from right after the text,
  so the input gets the room), in a Ticket column with the Wide page setting from 1280 px,
  and at the end of the timer's field in both.
- Wide page is a user setting (`user_settings.wide_timer`, off by default) in the View
  popover beside Compact rows. On, the Timer page is up to 88rem and the timer spans the
  summary column.
- Storage: a nullable `time_entry.ticket` column, indexed on organization and ticket for
  reports. A `time_entry_ticket` table was only needed for several tickets per entry.
- Existing entries: the migration that adds the column moves the key at the start of each
  description into it, with the rules of the detection module (`docs/migrations.md` for a
  data change).
- Organization, General has an Issue links setting that links chips to the tracker.

## Acceptance criteria

- [x] Entries store their ticket in `time_entry.ticket`. `createEntry`, `updateEntry` (the
      running entry's too), and `startTimer` take it, and the server checks its format.
- [x] One tested module finds the ticket in the committed text as the prototype does: a key
      at the start leaves the text and replaces the ticket, a later one stays and is used only
      without a ticket, pasted issue links become keys, the listed standards stay text, and
      keys the saved text already had are not found again.
- [x] The chip shows after the text in the timer bar, the entry popover, every layout's rows,
      recent work, and Continue recent. Its × turns it back into text, and
      picking recent work or Continue copies the ticket.
- [x] Organization, General: admins and owners set Issue links, an `https://` URL with
      `{key}`. Chips link to it when set.
- [x] Wide page (`user_settings.wide_timer`) widens the Timer page to 88rem, spans the timer
      across the summary column, and gives rows a Ticket column; off, the page keeps the
      header's width and the chip follows the text.
- [x] Reports can group and filter by ticket, and both exports have a Ticket column.
- [x] The migration adds `time_entry.ticket` and moves the key at the start of existing
      descriptions into it.
- [x] `docs/architecture.md` records the storage, the detection rules, and the setting.

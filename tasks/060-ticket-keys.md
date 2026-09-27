# 060: Ticket keys on entries

Status: todo

Descriptions often start with an issue key such as `NBW-412`. Entries get their own list
of ticket keys, shown as chips and found when a description is committed. The design is in
`prototypes/timer.html` and `organization.html` (`prototypes/README.md`, "Ticket keys"),
decided on 2026-09-27: keys are stored beside the description, a chip's × turns its key
back into text, a key mid-sentence stays in the text, and an organization setting links
chips to its tracker. The company seed (`bun run db:seed --company`) has descriptions with
keys at the start, in brackets, mid-sentence, two per entry, and `Q3-2026`.

## Decisions

- Storage: a `time_entry_ticket` table (entry, organization, key, position), indexed on
  organization and key, because reports group and filter by ticket. A JSON text column was
  rejected: SQLite can't index its elements.
- Existing entries: a migration moves the keys at the start of existing descriptions into
  tickets, with the same rules as the detection module (`docs/migrations.md` for a data
  change).

## Acceptance criteria

- [ ] Entries store their ticket keys, in order, in `time_entry_ticket`. `createEntry`,
      `updateEntry` (the running entry's too), and `startTimer` take them, and the server
      checks each key's format.
- [ ] One tested module finds keys in the committed text as the prototype does: keys at the
      start leave the text, later ones stay, pasted issue links become keys, the listed
      standards stay text, and keys the saved text already had are not found again.
- [ ] Chips show in the timer bar, the entry popover, every layout's rows, recent work, and
      Continue recent. The × and Backspace before the text turn a chip back into text, and
      picking recent work or Continue copies the tickets.
- [ ] Organization, General: admins and owners set Issue links, an `https://` URL with
      `{key}`. Chips link to it when set.
- [ ] The Timer page is wide, up to 88rem, and the timer bar spans the summary column.
- [ ] Reports can group and filter by ticket, and both exports have a Ticket column.
- [ ] The migration moves the keys at the start of existing descriptions into tickets.
- [ ] `docs/architecture.md` records the storage, the detection rules, and the setting.

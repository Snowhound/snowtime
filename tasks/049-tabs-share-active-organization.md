# 049: Tabs that disagree on the active organization

Status: todo

Task 039 found on 2026-09-25 that a tab can show one organization while its server calls
act on another. The active organization lives on the session, which every tab shares.
When tab 2 switches from Harbor to Northwind, tab 1 keeps Harbor in its header until its
session query refetches: on focus, and only once it is 30 seconds stale. Meanwhile each
refetch in tab 1 stores Northwind's data under Harbor's query keys.

Repro, with Max Member in two tabs on `/timer` in Harbor: switch tab 2 to Northwind, then
change an entry's end in tab 1. The server refuses the edit, since the entry isn't in
Northwind, and tab 1 then lists Northwind's entries, each as "Unavailable project", under
the Harbor header. A manual entry without a project would land in Northwind.

Two fixes fit the recorded decisions:

- The client sends the organization it shows with each scoped call, and `scopeMiddleware`
  refuses a call whose organization differs from the session's, with a code the client
  answers by reading the session again. The session stays the source of the active
  organization ("Tenancy" in `docs/architecture.md`).
- Each tab keeps its own organization, and the server uses the one the call names after
  checking membership. Tabs then work side by side, but the active organization stops
  being the session's alone, which changes "Tenancy".

Recommended: the first, as it keeps one active organization per session. A
`BroadcastChannel` telling other tabs about a switch narrows the window but can't close
it, since a call can be in flight during the switch.

## Acceptance criteria

- [ ] A tab showing an organization never stores or shows another organization's data
      under it, and never writes to another organization
- [ ] After another tab switches, this tab either follows the switch or refuses its next
      call with a message, and shows the right organization after either
- [ ] A test covers a scoped call made with a stale organization

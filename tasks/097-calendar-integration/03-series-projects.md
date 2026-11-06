# 097.03: A project per series

Status: todo

A recurring series carries a project, so every meeting of it logs to that project, and its
upcoming meetings already show in the project's color. The user sets it from any occurrence's
popover, and Settings lists the rules. Manual logging uses rules at once; auto-track
(subtask 04) uses them too.

## Initial ideas

- A rule is per organization and user, since projects belong to an organization. Its key is
  the series key the adapter builds, so it matches every occurrence exactly, unlike
  Toggl's keyword rules.
- Saving a rule fills the project of the series' unlogged events; entries already logged
  keep theirs, as in Toggl. Removing a rule changes no entry.
- A rule also says whether auto-track logs the series, default yes, so a series such as
  a lunch block can be left out.
- An event with no rule takes the project of the user's latest entry with the same
  description in the last 90 days, if any, as a suggestion the user can change. Subtask 02
  suggests from the entries the timer has loaded (`suggestProject`); this subtask reads the
  90 days from the server.
- A rule whose project is archived or deleted no longer applies; its events log without a
  project, and Settings marks the rule.
- Known gap: when someone edits "this and following events" in Google, Google starts a new
  series with a new id, and the old rule stops matching. Settings lists rules with the
  series' last seen title, so the user can spot it.

## Acceptance criteria

- [ ] A migration adds `calendar_series_rule`, and the datamodel shows it
- [ ] An event's popover sets, changes, and removes its series' project and auto-track
      choice
- [ ] Upcoming and unlogged events of a series show its project's color
- [ ] Logging from the popover or the dialog uses the rule's project
- [ ] An event without a rule suggests the project of the latest same-description entry
- [ ] Settings lists the rules in the current organization, editable and removable
- [ ] A rule on an archived or deleted project logs without a project and is marked
- [ ] Tests cover rule matching, the suggestion, and the archived project

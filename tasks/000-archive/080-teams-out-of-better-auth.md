# 080: Teams out of Better Auth

Status: done

Move team writes from Better Auth's organization plugin into the teams domain, so teams
become ordinary app data, like projects. Task 081's native backend builds on
better-auth-rs, which has no teams (roadmap phases 14 and 15, outside its v1). Kait chose
this over a teams plugin for better-auth-rs on 2026-10-02 (task 081, question 5). It
reverses the decision in `docs/architecture/data.md` ("Tenancy") that wrapping the
plugin's team endpoints would duplicate its checks for no new rule, so this change updates
that section.

Today the UI calls the plugin to create, rename, and delete teams and to add and remove
team members (`src/features/organization/queries.ts`). The plugin also stores a team on an
invitation and adds the person to it on acceptance, and deletes a removed member's team
rows. The teams domain already owns team roles and the team lists
(`src/server/teams/teams.server.ts`).

## What changes

- Server functions in `src/server/teams/` create, rename, and delete teams and add and
  remove members. Their rules keep the plugin's behavior: admins and owners only, the name
  checks now in `name-checks.server.ts`, `teamsPerOrganization`, names unique within the
  organization, and the last team deletable. Refusals are `AppError`s with messages in
  English and Estonian.
- The organization view calls them instead of `authClient.organization`, with the same
  optimistic updates.
- Invitations into a team stay, as the app's own step: the app's invite call stores the
  team on `invitation.team_id`, and its accept call adds the new member to that team
  after Better Auth accepts. Both backends can do this without hooking into Better Auth's
  routes. If this turns out awkward, the fallback is invitations that name only the
  organization, with admins adding people to teams after they join; ask Kait first.
- The hook that stops a removed member's timer also deletes their team rows.
- The organization plugin runs without `teams`. Decide whether the unused
  `session.active_team_id` goes, which needs a table rebuild (`docs/migrations.md`), or
  stays.

A small redesign of how teams work is open for discussion if it makes this task or task
081 simpler. Raise it with Kait before making it.

## Acceptance criteria

- [x] No team write goes through Better Auth, and the organization plugin runs without
      `teams`
- [x] Tests on seeded databases for each rule above, including an invitation into a team
      and a removed member losing their team rows
- [x] The organization view works as before, checked in the browser in both languages
- [x] `docs/architecture/data.md` ("Tenancy") and the stack table in
      `docs/architecture/README.md` describe teams as app rules; the DBML follows any
      schema change
- [x] `bun run test`, lint, and `bun run perf` pass

## Implementation and validation

The teams domain owns writes, including member counts. Invitations use app server
functions around Better Auth's invitation checks; the app stores the team and adds the
recipient after acceptance. The invite function keeps the invitation rate per user.
The removal hook handles both removal and leaving. The inherited team columns and unused
`session.active_team_id` stay, so this change needs no migration.

Seeded tests cover permissions, names, uniqueness, the team cap, organization boundaries,
last-team deletion, invitations, and removal cleanup. Browser checks on port 3080 cover
team controls in English and Estonian and accepting a team invitation, with desktop and
narrow layouts. `bun run test`, lint, TypeScript, Knip, formatting, schema drift, and
`bun run perf` pass.

The organization bundle baseline increases from 233,021 to 235,671 gzipped bytes for the
new team and invitation RPCs. Compared with unchanged HEAD built with the same dependencies
(234,914 bytes), this change adds 562 bytes. Other route and server budgets, query plans,
and report-read baselines stay unchanged.

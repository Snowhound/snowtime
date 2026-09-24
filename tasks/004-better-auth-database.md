# 004: Better Auth on the database

Status: todo

Connect Better Auth to Turso through the Drizzle adapter, with the organization
plugin and teams.

## Acceptance criteria

- [ ] Drizzle adapter uses the hand-written schema from task 003
- [ ] Organization plugin with teams enabled
- [ ] Better Auth generates UUIDv7 ids
- [ ] `team_member.role` exposed as an additional field, or a fallback table if the
      plugin does not support additional fields on team members (record the outcome in
      `docs/architecture.md`)
- [ ] Organization deletion disabled in the plugin (users and orgs are never hard-deleted)
- [ ] Account deletion anonymizes the user instead of deleting the row
- [ ] Sign up, sign in, create organization, invite, create team work locally
- [ ] Type errors in `src/routes/api/auth/$.ts` resolved

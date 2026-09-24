# 004: Better Auth on the database

Status: todo

Connect Better Auth to Turso through the Drizzle adapter, with the organization
plugin and teams.

## Acceptance criteria

- [ ] Drizzle adapter uses the hand-written schema from task 003
- [ ] Organization plugin with teams enabled
- [ ] Better Auth generates UUIDv7 ids
- [x] `team_member.role`: Better Auth 1.7 has no additional fields on team members, so
      it is an app-managed column (recorded in `docs/architecture.md`)
- [ ] Organization deletion disabled in the plugin (users and orgs are never hard-deleted)
- [ ] Account deletion anonymizes the user instead of deleting the row
- [ ] Sign up, sign in, create organization, invite, create team work locally
- [ ] Type errors in `src/routes/api/auth/$.ts` resolved

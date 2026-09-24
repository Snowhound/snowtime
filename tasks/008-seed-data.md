# 008: Seed data

Status: done

Local demo data so the UI and reports have something realistic to show, and known
users for signing in locally with a password (the only place password sign-in is
enabled). Tests reuse the same data as fixtures.

## Acceptance criteria

- [x] `bun run db:seed` for the local database only (refuses a non-`file:` URL)
- [x] The seed is a function (`seed(db)`) the script calls and tests reuse on their
      throwaway databases
- [x] The system user (`SYSTEM_USER_ID` in `src/db/actor.ts`) and seeded users with
      verified emails and one known local password, hashed the way Better Auth hashes
      passwords; one user per role (owner, admin, team lead, member)
- [x] Seeded users and the password listed in the root `README.md`
- [x] Two organizations, a few teams with leads, members in several teams
- [x] Projects with and without team assignments, one archived
- [x] A few weeks of entries, including one crossing midnight and one running timer

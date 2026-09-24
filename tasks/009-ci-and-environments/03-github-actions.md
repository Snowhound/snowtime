# 03: GitHub Actions

Status: in-progress

`.github/workflows/ci.yml` runs the checks that need no accounts. The migrate steps wait
on Turso access: the `staging` and `prod` databases and their tokens as CI secrets
(subtask 01).

## Acceptance criteria

- [x] On PRs and pushes to main: type check, `bun test`, `db:drift` (warning only), and
      `datamodel:check`
- [x] On PRs and pushes to main: `format:check` and `lint` (task 025)
- [ ] On PR: `db:migrate` (which runs `db:verify`) against `staging` (needs Turso access)
- [ ] On merge to main: `db:migrate` against `prod` before promotion (needs Turso access)
- [x] Migrations never run in the Vercel build: `build` runs only `vite build`

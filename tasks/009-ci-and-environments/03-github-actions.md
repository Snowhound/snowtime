# 03: GitHub Actions

Status: todo

## Acceptance criteria

- [ ] On PR: type check, `bun test`, `db:drift` (warning only)
- [ ] On PR: `db:migrate` (which runs `db:verify`) against `staging`
- [ ] On merge to main: `db:migrate` against `prod` before promotion
- [ ] Migrations never run in the Vercel build

# 011: Env validation on Valibot

Status: todo

`src/env.ts` validates with Zod while `docs/architecture.md` names Valibot.

## Acceptance criteria

- [ ] `src/env.ts` on Valibot (t3-env supports Standard Schema), with `TURSO_*`,
      `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- [ ] `zod` removed from dependencies if nothing else needs it

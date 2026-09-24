# 011: Env validation on Valibot

Status: done

`src/env.ts` validates with Zod while `docs/architecture.md` names Valibot.

## Acceptance criteria

- [x] `src/env.ts` on Valibot (t3-env supports Standard Schema), with `TURSO_*`,
      `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`; server-only
- [x] `zod` removed from dependencies

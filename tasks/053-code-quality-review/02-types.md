# 02: Types

Status: todo

A loose type at a module's boundary spreads to every caller. Inside a function it only
costs that function.

## Acceptance criteria

- [ ] No `any` in exported signatures, props, or query and server function results;
      `unknown` or a precise type replaces it
- [ ] Each remaining `any`, `as` cast, non-null `!`, and `@ts-expect-error` is needed
      and has a reason, or goes
- [ ] Types derive from one source (the Drizzle schema, Valibot schemas, server
      function return types) rather than being restated by hand
- [ ] oxlint enforces what's decided, for example `typescript/no-explicit-any`

## Findings

# Agent rules

## Project context

- Product scope: `docs/product.md`
- Architecture decisions: `docs/architecture.md`
- Data model: `datamodel/` (DBML diagram, `bun run datamodel` to view)
- Migrations: `docs/migrations.md` — read before touching the schema
- Hosting constraints: `docs/hosting.md`
- Task tracking: `tasks/` (see `tasks/README.md`)
- Writing docs: `.claude/skills/google-style/SKILL.md`
- UI prototypes: `prototypes/` (see `prototypes/README.md`); browser checks via
  `docs/skills/ui-review/SKILL.md`

Follow the recorded decisions; if a change contradicts one, update the doc in
the same change or ask first.

## Code conventions

- Icon components end in `Icon`, so JSX shows what they are. Import a Lucide icon as its
  file name in PascalCase plus `Icon`: `import ClockIcon from 'lucide-solid/icons/clock'`.
  `bun run icons:check` checks these imports and runs in `bun run test`;
  `bun run icons:fix` renames them. Name hand-written icons the same way, for example
  `GoogleIcon`.
- Inside `src/`, import with relative paths (`../lib/utils`). Code outside it, in
  `scripts/` and `datamodel/`, imports from `src/` through the `~/` alias
  (`~/db/schema`) instead of `../src/`; oxlint checks that.
- Write named functions as `function` declarations, not arrows assigned to a `const`,
  including derived values inside components (`function total() { ... }`). An arrow is
  fine as an inline callback, or where a type annotation needs a `const`
  (`const Card: Component<...> = ...`). oxlint's `func-style` checks this; the copied
  Solid-UI components in `src/components/ui/` are exempt so they stay as the registry has them.
- A lefthook pre-commit hook (`lefthook.yml`, installed by `bun install`) runs
  `oxlint --fix` and `oxfmt` on the staged files; CI checks the whole repository. Disable a
  lint rule inline only with a reason: `// oxlint-disable-next-line rule -- why`.

## Commits

- One or two lean sentences, imperative mood.
- No body, no `Co-Authored-By` or any other trailers.

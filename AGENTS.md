# Agent rules

## Project context

- Product scope: `docs/product.md`
- Local setup, seeded users, and scripts: `docs/development.md`
- Architecture decisions: `docs/architecture/`
- Data model: `datamodel/` (DBML diagram, `bun run datamodel` to view)
- Migrations: `docs/migrations.md` — read before touching the schema
- Hosting constraints: `docs/hosting.md`
- Setting up a deployment: `docs/deployment/README.md`
- Task tracking: `tasks/` (see `tasks/README.md`)
- Writing docs: `.claude/skills/google-style/SKILL.md`
- UI prototypes: `prototypes/` (see `prototypes/README.md`); browser checks via
  `docs/skills/ui-review/SKILL.md`

Follow the recorded decisions; if a change contradicts one, update the doc in
the same change or ask first.

## Shared skills

Codex discovers the writing and UI review skills through symlinks in `.agents/skills/`.
Edit their source files at the paths above so both agents use the same instructions.

## Code conventions

- Icon components end in `Icon`, so JSX shows what they are. Import a Lucide icon as its
  file name in PascalCase plus `Icon`: `import ClockIcon from 'lucide-solid/icons/clock'`.
  `bun run icons:check` checks these imports and runs in `bun run test`;
  `bun run icons:fix` renames them. Name hand-written icons the same way, for example
  `GoogleIcon`.
- Frontend code is grouped by feature in `src/features/<name>/` (`timer`, `settings`,
  `auth`, `reports`). A feature holds its page component (`<Name>Page` in
  `<name>-page.tsx`), subcomponents, queries and mutations, helpers, and tests, so one
  folder holds what a change to that view touches.
- Route files in `src/routes/` only wire the route: search params, `beforeLoad`, loader,
  pending component, and head. They render the feature's page and pass it search params
  and route context as props. A prop read once for an initial value is named
  `initial<Name>` (`initialError`), which Solid's reactivity lint accepts.
- A page whose loader waits on the server has a `<Name>Pending` (`<name>-pending.tsx`,
  built on `src/components/page-pending.tsx`) that the router shows while it loads, so a
  link opens at once.
- Features don't import from each other; oxlint allows imports from `src/features/` only
  in routes and `src/router.tsx`. Code starts in its feature and moves once a second
  feature needs it: components to `src/components/`, everything else to `src/lib/`.
  `src/lib/` also holds generic helpers and code the server shares, such as `calendar.ts`.
  `src/components/ui/` holds only the Solid-UI registry copies. Files there that serve one
  concern share a subfolder, as the seasonal scene's do in `src/lib/scene/` and
  `src/components/scene/`.
- A component gets its own folder, `<name>/<name>.tsx`, once it has subcomponents,
  helpers, or tests that nothing else in the feature uses.
- Backend code is grouped by domain in `src/server/<domain>/` ("Application rules" in
  `docs/architecture/README.md`). The client reaches it only through the JSON API. A new
  call adds:
  - a route in the domain's `<domain>.routes.ts`, whose handler is one call of its rule:
    `.patch('/entries/:id', input(UpdateEntryInput), (c) => run(c, entries.updateEntry))`;
  - a function in the domain's client module, `src/lib/api/<domain>.ts`, that sends it with
    `request(method, path, input, OutputSchema)`, and which queries and mutations import;
  - its input and output schemas in `<domain>.schemas.ts`, and conformance tests in
    `conformance/`.

  A GET only reads; a read with a filter object for input is a POST marked `reads` on its
  route. Only `src/server/auth/` imports Better Auth. Client code imports a domain's
  `*.schemas.ts`, plus `src/server/errors.ts` and `src/server/schemas.ts`. It never imports
  `*.server.ts` or `*.routes.ts`, not even for a type.

- Import with a relative path inside the importer's area: one feature folder,
  `src/server/`, or another top-level folder of `src/`. Import anything else through the
  `~/` alias for `src/` (`~/lib/format`, `~/server/timer/timer.schemas`), as
  `scripts/` and `datamodel/` do. oxlint checks this: no parent imports where the area is
  flat, and none that climb two levels inside a feature or `src/server/`.
- Write named functions as `function` declarations, not arrows assigned to a `const`,
  including derived values inside components (`function total() { ... }`). An arrow is
  fine as an inline callback, or where a type annotation needs a `const`
  (`const Card: Component<...> = ...`). oxlint's `func-style` checks this; the copied
  Solid-UI components in `src/components/ui/` are exempt so they stay as the registry has them.
- Comment only where the code is hard to follow without it, and say only what a reader
  of that code needs: why, a constraint, or a contract the code can't show. Don't restate
  the next line, and don't describe earlier versions, the mock-up, or the task that added
  the code; history belongs in git. Keep file headers to what the file is for, citing a
  prototype or doc only where it helps. If most of a block needs explaining, simplify the
  code before writing the comment.
- A lefthook pre-commit hook (`lefthook.yml`, installed by `bun install`) runs
  `oxlint --fix` and `oxfmt` on the staged files, then `knip` on the project; CI checks the
  whole repository. Disable a lint rule inline only with a reason:
  `// oxlint-disable-next-line rule -- why`.

## Commits

- One or two lean sentences, imperative mood.
- No body, no `Co-Authored-By` or any other trailers.

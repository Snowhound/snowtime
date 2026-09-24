# 025: Lint and format with oxlint and oxfmt

Status: done

The repo has no linter or formatter. Add both from the Oxc toolchain that Vite 8 already
builds on.

- **oxlint** runs fast enough for every commit and loads `eslint-plugin-solid` through
  its JS plugin support, which Biome cannot match on Solid rules. Type-aware rules come
  from `oxlint-tsgolint`, which catches floating promises in server functions and
  mutations.
- **oxfmt** is the formatter. It replaces Prettier; the project uses no Prettier of its
  own. Prettier appears in `bun.lock` only as a dependency of
  `@tanstack/router-generator`, which formats `routeTree.gen.ts`; that stays.

## Acceptance criteria

- [x] `oxlint`, `oxlint-tsgolint`, and `oxfmt` in dev dependencies, configured in
      `.oxlintrc.json` and `.oxfmtrc.json`
- [x] Plugins on: `typescript`, `import`, `unicorn`, `vitest`, and `eslint-plugin-solid`
      as a JS plugin
- [x] Type-aware rules on, including `no-floating-promises` and `no-misused-promises`
- [x] Generated files ignored by both tools: `src/paraglide/`, `routeTree.gen.ts`,
      `drizzle/`, `.output/`, plus `prototypes/`
- [x] Scripts: `lint`, `format`, and `format:check`
- [x] The codebase is formatted in one commit that holds only formatting changes
- [x] `bun run lint` passes; fix findings or disable a rule with a stated reason
- [x] CI runs `bun run lint` and `bun run format:check` (task 009, subtask 03)
- [x] The oxc VS Code extension is recommended in `.vscode/extensions.json` and set as
      the default formatter in `.vscode/settings.json`
- [x] No Prettier in the project: no direct dependency, config file, or editor setting
- [x] `docs/architecture.md` records the choice

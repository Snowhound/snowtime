# 025: Lint and format with oxlint and oxfmt

Status: todo

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

- [ ] `oxlint`, `oxlint-tsgolint`, and `oxfmt` in dev dependencies, configured in
      `.oxlintrc.json` and `.oxfmtrc.json`
- [ ] Plugins on: `typescript`, `import`, `unicorn`, `vitest`, and `eslint-plugin-solid`
      as a JS plugin
- [ ] Type-aware rules on, including `no-floating-promises` and `no-misused-promises`
- [ ] Generated files ignored by both tools: `src/paraglide/`, `routeTree.gen.ts`,
      `drizzle/`, `.output/` (confirm the paths)
- [ ] Scripts: `lint`, `format`, and `format:check`
- [ ] The codebase is formatted in one commit that holds only formatting changes
- [ ] `bun run lint` passes; fix findings or disable a rule with a stated reason
- [ ] CI runs `bun run lint` and `bun run format:check` (task 009, subtask 03)
- [ ] The oxc VS Code extension is recommended in `.vscode/extensions.json` and set as
      the default formatter in `.vscode/settings.json`
- [ ] No Prettier in the project: no direct dependency, config file, or editor setting
- [ ] `docs/architecture.md` records the choice

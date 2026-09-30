# 03: JS bundles

Status: todo

The client code is mostly what it must be, so this is about its shape: what loads first,
what loads twice, and what loads on a page that doesn't need it. Task 037 already moved
the page components out of the entry chunk.

## Candidates to check

- The entry chunk, module by module: what a page could load later without the page waiting
  for it. `src/lib/scene/weather.ts` (1,500 lines of shaders and presets) runs only after the
  first paint, so it may not need to be in the entry.
- Modules that appear in more than one chunk.
- The Better Auth client and its plugins (passkey, organization): which pages need which.
- Paraglide messages: whether each page loads only its messages and only the active locale.
- Router and query devtools: confirm none of it reaches the production build.
- Kobalte and Lucide: only the components and icons used.
- `modulepreload` links on each page: none for chunks the page doesn't use.
- The server bundle: its size sets the function's cold start on Vercel. Look for client-only
  or dev-only packages in it.

Use a one-off look at the build (Rolldown's output, or a visualizer run with `bunx`, not a
new dependency); the budgets in subtask 01 keep the result.

## Acceptance criteria

- [ ] The entry chunk and each route's chunks listed with their largest modules
- [ ] Changes made where a page loads code it doesn't need, with gzipped sizes before and
      after per route
- [ ] The server bundle's size and largest packages recorded, and trimmed if something
      doesn't belong there

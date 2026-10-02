# 079: Static route shells

Status: todo (waits on task 078's baseline)

Serve each page as an HTML file built ahead of time instead of rendering it on the server
for every request. The shell holds everything that isn't per-user, with the route's
skeleton where per-user content goes. The client fetches the data, renders without
hydration, and routes as it does today. Server rendering is the largest cost on today's
server: 15 to 50 ms of CPU for an ordinary page and 85 to 92 ms for the 9-month report
(`docs/hosting.md`), and up to 385 KB of HTML for the year report
(`perf/baselines/pages.json`). Without it, Caddy or Vercel's CDN serves the pages, and task
080's native backend only has to answer the API. Users must be no worse off, measured
before and after.

## Design to confirm

- One shell per route and language. The locale is already a cookie
  (`project.inlang/paraglide.config.ts`), so Caddy and Vercel pick the shell by the
  cookie, and by `Accept-Language` for signed-out visitors.
- The skeleton is the route's `<Name>Pending` component.
- An inline script starts the route's data requests from the URL before the bundle loads,
  and the loaders take those requests instead of starting their own.
- The head script that applies the device's theme today (`src/routes/__root.tsx`) reads
  the user's theme and scene from a cookie, so nothing flashes before the session arrives.
- Caddy and Vercel redirect to `/sign-in` when the session cookie is missing. The client
  redirects for an expired session.
- The content security policy uses script hashes, because a static file can't carry a
  nonce. Caddy and `vercel.json` set it.
- Public pages (sign-in, privacy, terms) are prerendered with their content.
- Server functions stay as they are. Only how the HTML is made changes; the contract is
  task 080's.
- The build uses Start's SPA mode, its prerendering, or a plain Vite build of the client,
  whichever gives per-route shells with the least code.

## Users no worse off

`perf:pages` runs before and after, with a cold and a warm cache, at the 4× CPU slowdown
and on a throttled network, on the timer page and the week and year reports. It reports:

- Time to the first paint, to the skeleton, and to content (the first entry row or
  timesheet cell)
- Main-thread time and long tasks until content
- Bytes of HTML, JS, CSS, and data
- Input latency of the existing interactions

Time to content must be no worse than today's with a warm cache. A loss with a cold cache
is recorded, and Kait decides whether it's acceptable. On the server side, task 078's
harness measures CPU per page load and capacity before and after.

## Acceptance criteria

- [ ] The build approach chosen, with the reason
- [ ] Every signed-in route served from a shell and the public pages prerendered, on Vercel
      and self-hosted, with no server rendering left
- [ ] No flash of the wrong theme, language, or scene, checked in the browser
- [ ] `perf:pages` numbers before and after show users no worse off, as defined above, and
      its budgets are updated
- [ ] Task 078's harness numbers before and after
- [ ] Docs updated: rendering in `docs/architecture/platform.md`, the content security
      policy in `docs/architecture/auth.md`, the deployment docs (Caddyfile, `vercel.json`),
      and the route conventions in `AGENTS.md`
- [ ] `bun run test`, lint, and `bun run perf` pass

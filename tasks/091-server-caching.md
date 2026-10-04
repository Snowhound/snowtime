# 091: Server-side caching

Status: todo

Find out whether caching anything in the server's memory would pay off, in both the
TypeScript backend and the native one (task 081). Measure before caching anything: a
cache adds staleness and invalidation, and every organization's cached data costs memory.

## Constraints

- Per-organization cached data stays at a few KB. More is acceptable only where
  measurements show a clear gain (Kait, 2026-10-04).
- Whatever is cached, cache it the same way in both backends, so they keep behaving the
  same and the conformance tests stay valid.
- One app process per database (`docs/hosting.md`), so an in-process cache doesn't need
  cross-process invalidation on self-hosted setups. The Vercel deployment runs several
  function instances, so a cache there may be stale on the other instances.

## Already decided

- **Better Auth's cookie cache stays in the TypeScript app** and isn't ported to the
  native one. It's a signed `session_data` cookie with a 5-minute `maxAge`
  (`src/server/auth/better-auth.server.ts`), so it uses no server memory. Turning it off
  measured about 0.2 ms more session time per call on a local file. On Turso, though, it
  saves a remote read on every call. The native backend reads the session row from a
  local file in under 0.05 ms. Leaving the cache out there also closes the up-to-5-minute
  window in which a revoked session still works.

## Candidates to measure

Read the `Server-Timing` header (task 088) and `perf:stress` (tasks 078, 090) to see where
time goes. Candidates are reads that repeat on almost every request and change rarely:

- the session row and the user's membership and role per organization (`resolveScope`);
- an organization's projects and teams, and the team assignments `listProjects` reads;
- the user's settings (time zone, week start);
- `getAppSession`'s data, which the browser fetches after every action.

For each candidate, record the time saved per request, the memory per organization and
in total on dataset M, and how the cache is invalidated on a write. Note the Turso case
separately, where a saved read is a saved network round trip.

## Acceptance criteria

- [ ] Each candidate measured, with a recommendation to cache it or not
- [ ] Any cache that's adopted implemented in the TypeScript backend, with its invalidation
      tested, and described in `docs/architecture/`
- [ ] A note in task 081 for the native backend to do the same

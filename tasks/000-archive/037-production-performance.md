# 037: Production performance pass

Status: done

Measured fixes before the first Vercel and Turso deploy, for the bundle, the background image,
caching, and queries. Measured on a production build behind a gzip proxy, cold cache, at
1440 × 900 with pixel ratio 2, with 150 ms latency, 1.6 Mbps, and 4× CPU slowdown.

| Page (JS gzipped)          | Before    | After     |
| -------------------------- | --------- | --------- |
| `/sign-in`                 | 214 KB    | 180 KB    |
| `/reports`                 | 237 KB    | 201 KB    |
| `/settings`                | 234 KB    | 214 KB    |
| `/timer`                   | 225 KB    | 229 KB    |
| First scene picture, whole | 4.9–5.2 s | 3.2–3.4 s |
| Scene images, cold visit   | 1,150 KB  | 781 KB    |

## Acceptance criteria

- [x] Route files import no page component for their loaders, so the timer and invitation
      pages leave the entry chunk (100 KB to 52 KB gzipped).
- [x] The scene loads the small image on its own before the sharp one, and a layer fades in
      only once its file has decoded.
- [x] `/backgrounds/` and `/brand/` are cached for a week on Vercel (`routeRules`).
- [x] The page preloads the Latin font file.
- [x] Queries compare `sys_deleted` with a literal `0`, so the running-timer and project
      queries use their partial indexes instead of scanning the table.
- [x] `account (provider_id, account_id)` has an index for OAuth sign-in.
- [x] Better Auth's `cookieCache` (5 minutes) saves two reads per server function call; a
      revoked session or erased user stays usable that long.
- [x] The scene serves AVIF, 17 to 37% smaller than WebP at the same or better SSIM, and falls
      back to WebP where a 1 × 1 probe doesn't decode.
- [x] Projects, teams, and members stay fresh for 5 minutes (`ORGANIZATION_STALE_TIME`), so a
      tab regaining focus doesn't refetch them every 30 seconds.
- [x] The timer bar, tab title, and entry popover count a running entry up to 24 hours
      (`runningMs`), as stopping it records.
- [x] Better Auth's cookie plugin is the Solid one (`better-auth/tanstack-start/solid`). The
      React one failed to import once `getSession` began refreshing the cache cookie.
- [x] An entry is at most 24 hours long, so `listEntries` and `reportData` bound `started_at`
      from below instead of reading the user's or the organization's entire history.

## Checked and left as is

- Link preloading: the router already preloads on intent (`defaultPreload: 'intent'`), which
  runs the loaders and warms the query cache.
- The images start after hydration, so they don't compete with the scripts.
- Lazy-loading the Appearance popover's content saved 4–6 KB gzipped per page, too little for
  the extra lazy boundary.

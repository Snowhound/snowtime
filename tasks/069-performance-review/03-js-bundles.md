# 03: JS bundles

Status: done

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

- [x] The entry chunk and each route's chunks listed with their largest modules
- [x] Changes made where a page loads code it doesn't need, with gzipped sizes before and
      after per route
- [x] The server bundle's size and largest packages recorded, and trimmed if something
      doesn't belong there

## Outcome

On 2026-09-30, split the shaders and WebGL renderer into
`src/lib/scene/weather-renderer.ts`. `SceneLayer` imports it when enabled weather first
needs it. Presets, colors in presets, and settings hints stay synchronous in `weather.ts`.
A settled import rechecks the current settings through a Solid signal. An import failure
leaves weather off with its failure hint. The renderer has only type imports, so it adds no shared runtime dependency.

The 75 golden frames match. The page harness passes with the same DOM counts and CSS.
Sign-in still loads weather after hydration: its total JS is 226,263 → 226,298 bytes
(+35), while pages with weather off avoid the 8,420-byte gzipped renderer. This shifts the
initial load; it does not reduce bytes when weather runs.

`bun run perf` and `bun run perf:pages --no-build` ran old, new, old, new in this
session. These are actual builds, not comparisons against older machine timings.
Route counts repeated exactly. Keep the server and CSS budgets unchanged; only route JS
budgets shrink. The chunk map includes the new lazy chunk for diagnostics.

| Route                | Before JS gzip | After JS gzip | Saved |
| -------------------- | -------------: | ------------: | ----: |
| `/sign-in`           |         226263 |        217878 |  8385 |
| `/$org/timer`        |         265238 |        256809 |  8429 |
| `/$org/reports`      |         236272 |        227865 |  8407 |
| `/$org/settings`     |         237782 |        229391 |  8391 |
| `/$org/projects`     |         238081 |        229671 |  8410 |
| `/$org/organization` |         240893 |        232478 |  8415 |

The review reran both harnesses on main and on the branch in one session, alternating (old,
new, old, new). Every byte count repeated, and the server bundle fell by the same 171 KB.
Simplifying the loader's state in `SceneLayer` saved another 20 bytes a route, included
above. `perf/baselines/pages.json` now holds the lower JS, so the page check keeps the gain
too. The review's hydration times were as mixed as the ones below: reports week
635/811/863/652 ms, sign-in 399/414/435/373 ms (old, new, old, new).

Hydration times (ms, 4× CPU slowdown) in the alternating page runs:

| Page         | Old A1 | New B1 | Old A2 | New B2 | Mean new / old |
| ------------ | -----: | -----: | -----: | -----: | -------------: |
| Reports week |   1058 |    676 |    638 |    728 |           0.83 |
| Reports year |    795 |    957 |    885 |    919 |           1.12 |
| Settings     |    565 |    543 |    612 |    612 |           0.98 |
| Sign-in      |    383 |    310 |    404 |    346 |           0.83 |
| Timer        |    597 |    629 |    681 |    659 |           1.01 |

These timings do not show a consistent hydration gain. The retained benefit is the byte
reduction when weather is off. Long tasks stay at two per page in all runs except the
first old sign-in run (three). Input-to-paint times also vary: starting the timer is
65/65/59/63 ms in A1/B1/A2/B2; opening its project field is 79/61/72/75 ms.

### One-off build inventory

The gzip bytes are `gzip -9` of each built file. A temporary Vite/Rolldown `generateBundle` hook recorded each chunk's `modules` and
`renderedLength` in `/tmp`, for the client, SSR intermediate, and Nitro output. The hook
was removed; no dependency or build step was added. Sizes below describe the original
build. Module sizes are rendered bytes before chunk minification, not independent gzip
contributions. Chunk names omit hashes.

The root preloads are shared by all routes, including sign-in and legal pages:

`index.js`, `use-query.js`, `preload-helper.js`, `passkeys.js`, `theme-toggle.js`, `scenery-fields.js`, `device-settings.js`, `legal_terms_title.js`, `nav_organization.js`, `folder-kanban.js`, `settings.js`, `page-pending.js`, `timer_no_description.js`, `season-tagline.js`, `separator.js`, `app-mark.js`, `OGE3DKII.js`, `loader-circle.js`, `auth-client.js`, `sign-in-methods.js`, `teams.js`, `projects.js`.

| Route                  | Own and parent preload chunks                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/$org`                | `_org.js`                                                                                                                                                                                                                                                      |
| `/create-organization` | `create-organization.js`, `auth_not_you.js`, `error-alert.js`, `text-field.js`, `form.js`, `mail.js`                                                                                                                                                           |
| `/privacy`             | `privacy.js`, `legal-layout.js`                                                                                                                                                                                                                                |
| `/sign-in`             | `sign-in.js`, `sign-in-methods.js`, `error-alert.js`                                                                                                                                                                                                           |
| `/terms`               | `terms.js`, `legal-layout.js`                                                                                                                                                                                                                                  |
| `/$org/organization`   | `organization.js`, `pencil.js`, `display-format.js`, `tabs.js`, `check.js`, `badge.js`, `dialog.js`, `error-alert.js`, `text-field.js`, `form.js`, `mail.js`, `trash.js`, `x.js`                                                                               |
| `/$org/projects`       | `projects.js`, `pencil.js`, `display-format.js`, `tabs.js`, `check.js`, `badge.js`, `dialog.js`, `ZZYKR3VO.js`, `error-alert.js`, `text-field.js`, `form.js`, `trash.js`, `project-dot.js`, `globe.js`                                                         |
| `/$org/reports`        | `reports.js`, `display-format.js`, `tabs.js`, `table.js`, `badge.js`, `toggle-group.js`, `moon.js`, `error-alert.js`, `x.js`, `project-dot.js`, `chevron-down.js`                                                                                              |
| `/$org/settings`       | `settings.js`, `display-format.js`, `settings_wide_timer_description.js`, `brand-logos.js`, `check.js`, `badge.js`, `dialog.js`, `toggle-group.js`, `region.js`, `circle-alert.js`, `text-field.js`, `form.js`, `globe.js`, `chevron-down.js`, `date-input.js` |
| `/$org/timer`          | `timer.js`, `display-format.js`, `table.js`, `settings_wide_timer_description.js`, `check.js`, `badge.js`, `ZZYKR3VO.js`, `toggle-group.js`, `error-alert.js`, `text-field.js`, `trash.js`, `x.js`, `project-dot.js`, `date-input.js`, `clock.js`              |
| `/invitation/$id`      | `invitation._id.js`, `auth_not_you.js`, `sign-in-methods.js`, `circle-alert.js`, `error-alert.js`, `clock.js`                                                                                                                                                  |

The following list gives the largest three modules in every client chunk. Shared chunks
are listed once; a route's static imports add them to its own preloads above. The
`universal.js` spreadsheet chunk is lazy and is absent from the initial route budgets.

| Chunk                                | Gzip bytes | Largest modules (rendered bytes)                                                                                                                                                          |
| ------------------------------------ | ---------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OGE3DKII.js`                        |       8998 | `@floating-ui/dom/dist/floating-ui.dom.mjs` 18345; `@floating-ui/core/dist/floating-ui.core.mjs` 17333; `@kobalte/core/dist/chunk/OGE3DKII.jsx` 9617                                      |
| `ZZYKR3VO.js`                        |       1282 | `@kobalte/core/dist/chunk/XUUROM4M.jsx` 2778; `@kobalte/core/dist/chunk/YFEENJN5.jsx` 794; `@kobalte/core/dist/chunk/FOXVCQFV.jsx` 749                                                    |
| `_org.js`                            |        233 | `src/routes/$org.tsx?tsr-split=component` 352                                                                                                                                             |
| `app-mark.js`                        |       1032 | `src/lib/app-icon.ts` 2462; `src/components/app-mark.tsx` 921                                                                                                                             |
| `auth-client.js`                     |      17544 | `@better-fetch/fetch/dist/index.js` 23458; `better-auth/dist/plugins/organization/error-codes.mjs` 5165; `@better-auth/passkey/dist/client.mjs` 5041                                      |
| `auth_not_you.js`                    |        177 | `src/paraglide/messages/auth_not_you.js` 349                                                                                                                                              |
| `badge.js`                           |        508 | `src/components/ui/badge.tsx` 1144                                                                                                                                                        |
| `brand-logos.js`                     |       1310 | `src/components/brand-logos.tsx` 2721; `src/paraglide/messages/sign_in_redirecting.js` 423; `src/paraglide/messages/sign_in_email.js` 348                                                 |
| `check.js`                           |        228 | `lucide-solid/dist/source/icons/check.jsx` 346                                                                                                                                            |
| `chevron-down.js`                    |        234 | `lucide-solid/dist/source/icons/chevron-down.jsx` 376                                                                                                                                     |
| `circle-alert.js`                    |        290 | `lucide-solid/dist/source/icons/circle-alert.jsx` 608                                                                                                                                     |
| `clock.js`                           |        254 | `lucide-solid/dist/source/icons/clock.jsx` 411                                                                                                                                            |
| `create-organization.js`             |       2097 | `src/features/auth/create-organization-page.tsx` 6012; `src/paraglide/messages/create_org_description.js` 571; `src/paraglide/messages/create_org_join_description.js` 558                |
| `date-input.js`                      |       1464 | `src/lib/date-input.ts` 4363; `lucide-solid/dist/source/icons/calendar.jsx` 568                                                                                                           |
| `device-settings.js`                 |       1891 | `src/lib/device-settings.ts` 4218; `src/server/settings/settings.schemas.ts` 2194; `src/components/legal-links.tsx` 977                                                                   |
| `dialog.js`                          |       2796 | `@kobalte/core/dist/chunk/ZR5G2IB7.jsx` 8945; `src/components/ui/dialog.tsx` 4196                                                                                                         |
| `display-format.js`                  |        908 | `src/lib/display-format.ts` 1411; `src/lib/format.ts` 1384; `src/paraglide/messages/duration_hours_minutes.js` 446                                                                        |
| `error-alert.js`                     |        269 | `src/components/error-alert.tsx` 459                                                                                                                                                      |
| `folder-kanban.js`                   |        401 | `lucide-solid/dist/source/icons/folder-kanban.jsx` 660; `src/paraglide/messages/nav_projects.js` 348                                                                                      |
| `form.js`                            |        142 | `src/lib/form.ts` 246                                                                                                                                                                     |
| `globe.js`                           |        280 | `lucide-solid/dist/source/icons/globe.jsx` 516                                                                                                                                            |
| `index.js`                           |      51262 | `@tanstack/router-core/dist/esm/load-client.js` 44288; `@kobalte/core/dist/chunk/FWLJS4DZ.jsx` 38324; `@tanstack/router-core/dist/esm/router.js` 34440                                    |
| `invitation._id.js`                  |       2816 | `src/features/auth/invitation-page.tsx` 10258; `src/paraglide/messages/invitation_expired_description.js` 672; `src/paraglide/messages/invitation_closed_description.js` 671              |
| `legal-layout.js`                    |       1054 | `src/features/legal/legal-layout.tsx` 2385; `src/paraglide/messages/legal_updated.js` 385                                                                                                 |
| `legal_terms_title.js`               |        246 | `src/paraglide/messages/legal_privacy_title.js` 406; `src/paraglide/messages/legal_terms_title.js` 394                                                                                    |
| `loader-circle.js`                   |        729 | `src/components/ui/native-select.tsx` 1050; `lucide-solid/dist/source/icons/loader-circle.jsx` 420                                                                                        |
| `mail.js`                            |        287 | `lucide-solid/dist/source/icons/mail.jsx` 459                                                                                                                                             |
| `moon.js`                            |        288 | `lucide-solid/dist/source/icons/moon.jsx` 435                                                                                                                                             |
| `nav_organization.js`                |        187 | `src/paraglide/messages/nav_organization.js` 375                                                                                                                                          |
| `organization.js`                    |      13915 | `src/features/organization/organization-view.tsx` 11782; `src/features/organization/teams-tab.tsx` 11777; `src/features/organization/invite-dialog.tsx` 11639                             |
| `page-pending.js`                    |       2255 | `src/components/page-title.tsx` 4773; `src/components/page-pending.tsx` 2409; `src/components/ui/card.tsx` 2202                                                                           |
| `passkeys.js`                        |       2860 | `src/components/app-icon-dialog.tsx` 5674; `src/components/radio-group.tsx` 1387; `src/paraglide/messages/app_icon_description.js` 746                                                    |
| `pencil.js`                          |        925 | `src/components/confirm-dialog.tsx` 1622; `lucide-solid/dist/source/icons/ellipsis.jsx` 571; `lucide-solid/dist/source/icons/pencil.jsx` 514                                              |
| `preload-helper.js`                  |      22798 | `@kobalte/core/dist/chunk/RFN6X5VH.jsx` 23819; `@kobalte/utils/dist/index.js` 13234; `@kobalte/core/dist/chunk/KEL2LLJM.jsx` 5551                                                         |
| `privacy.js`                         |       6193 | `src/features/legal/privacy-page.tsx` 20598; `src/routes/privacy.tsx?tsr-split=component` 100                                                                                             |
| `project-dot.js`                     |        698 | `src/components/duration.tsx` 756; `src/components/project-dot.tsx` 544; `src/lib/colors.ts` 529                                                                                          |
| `projects.js`                        |      10646 | `src/features/projects/project-list.tsx` 11525; `src/features/projects/project-dialog.tsx` 10214; `src/features/projects/projects-view.tsx` 8785                                          |
| `projects.js`                        |        684 | `src/server/projects/projects.functions.ts` 1515; `src/lib/queries/projects.ts` 322                                                                                                       |
| `region.js`                          |        544 | `src/lib/holidays/region.ts` 1385                                                                                                                                                         |
| `reports.js`                         |      21387 | `src/features/reports/reports-view.tsx` 17379; `src/features/reports/entries-card/report-entry-list.tsx` 16883; `src/features/reports/filter-bar.tsx` 13753                               |
| `scenery-fields.js`                  |      14021 | `src/lib/scene/weather.ts` 38608; `src/components/scene/scenery-fields.tsx` 11671; `src/paraglide/messages/scene_intro_hint.js` 612                                                       |
| `season-tagline.js`                  |       7320 | `src/lib/taglines/catalogue.ts` 12973; `src/lib/calendar.ts` 3672; `src/lib/taglines/taglines.ts` 3273                                                                                    |
| `separator.js`                       |       2267 | `@kobalte/core/dist/chunk/PYSNB6I6.jsx` 7183; `src/components/ui/switch.tsx` 1543; `src/components/ui/separator.tsx` 434                                                                  |
| `settings.js`                        |        404 | `lucide-solid/dist/source/icons/settings.jsx` 741; `src/paraglide/messages/nav_timer.js` 324                                                                                              |
| `settings.js`                        |      12275 | `src/features/settings/sign-in-methods-list.tsx` 13338; `src/features/settings/scenery-picker/scenery-picker.tsx` 10991; `src/features/settings/preferences-card/region-fields.tsx` 10564 |
| `settings_wide_timer_description.js` |        463 | `src/paraglide/messages/settings_wide_timer_description.js` 558; `src/paraglide/messages/settings_show_summary.js` 413; `src/paraglide/messages/settings_compact_rows.js` 412             |
| `sign-in.js`                         |        801 | `src/features/auth/sign-in-page.tsx` 1829; `src/paraglide/messages/sign_in_description.js` 497; `src/routes/sign-in.tsx?tsr-split=component` 272                                          |
| `sign-in-methods.js`                 |        168 | `src/lib/queries/sign-in-methods.ts` 180                                                                                                                                                  |
| `sign-in-methods.js`                 |       3229 | `src/features/auth/sign-in-methods.tsx` 10335; `lucide-solid/dist/source/icons/eye-off.jsx` 717; `src/paraglide/messages/sign_in_error_unverified.js` 623                                 |
| `table.js`                           |       3513 | `src/components/date-time/calendar.tsx` 5804; `src/components/date-time/date-picker.tsx` 5747; `src/components/ui/table.tsx` 2478                                                         |
| `tabs.js`                            |       3178 | `@kobalte/core/dist/chunk/PTWD4LYA.jsx` 12773; `src/components/ui/tabs.tsx` 1304; `@solid-primitives/resize-observer/dist/index.js` 1154                                                  |
| `teams.js`                           |        434 | `src/server/teams/teams.functions.ts` 586; `src/lib/queries/teams.ts` 258                                                                                                                 |
| `terms.js`                           |       4221 | `src/features/legal/terms-page.tsx` 15077; `src/routes/terms.tsx?tsr-split=component` 96                                                                                                  |
| `text-field.js`                      |      16302 | `@tanstack/form-core/dist/esm/FormApi.js` 35494; `@tanstack/form-core/dist/esm/FormGroupApi.js` 23624; `@tanstack/form-core/dist/esm/FieldApi.js` 19327                                   |
| `theme-toggle.js`                    |       3391 | `src/components/scene/scene-layer.tsx` 6303; `src/components/scene/intro.tsx` 3474; `src/components/theme-toggle.tsx` 1433                                                                |
| `timer.js`                           |      36360 | `@kobalte/core/dist/chunk/6D6OMZOC.jsx` 20111; `src/features/timer/calendar/timer-calendar.tsx` 17059; `src/features/timer/timer-view.tsx` 16774                                          |
| `timer_no_description.js`            |        191 | `src/paraglide/messages/timer_no_description.js` 405                                                                                                                                      |
| `toggle-group.js`                    |       2064 | `@kobalte/core/dist/chunk/TP2BLHDF.jsx` 6096; `@kobalte/core/dist/chunk/WAUM5GOD.jsx` 1325; `src/components/ui/toggle-group.tsx` 1184                                                     |
| `trash.js`                           |        315 | `lucide-solid/dist/source/icons/trash.jsx` 647                                                                                                                                            |
| `universal.js`                       |      19247 | `fflate/esm/browser.js` 19248; `write-excel-file/modules/xlsx/generateXlsxFileContents.js` 10123; `write-excel-file/modules/xlsx/features/images.js` 9119                                 |
| `use-query.js`                       |      56948 | `tailwind-merge/dist/bundle-mjs.mjs` 56672; `seroval/dist/index.js` 50517; `solid-js/dist/solid.js` 38685                                                                                 |
| `x.js`                               |        233 | `lucide-solid/dist/source/icons/x.jsx` 372                                                                                                                                                |

### Server inventory

The original harness size is 6,628,190 bytes (excluding traced native `node_modules`).
After the weather split it is 6,629,149 bytes. The largest files are:

| File/package                            | Original bytes | Largest original modules (rendered bytes)                                                       |
| --------------------------------------- | -------------: | ----------------------------------------------------------------------------------------------- |
| `@better-auth/core+[...].mjs`           |        1330702 | OpenTelemetry semantic trace attributes 143323; stable attributes 79108; Zod core schemas 71826 |
| `@better-auth/passkey+[...].mjs`        |         751604 | `@peculiar/x509` 92831; `asn1js` 88652; `reflect-metadata` 43844                                |
| `_ssr/middleware.mjs`                   |         597523 | SSR intermediate middleware 592707; Better Auth implementation is bundled in this intermediate  |
| `@better-auth/kysely-adapter+[...].mjs` |         504358 | Kysely default compiler 31093; auth adapter 30834; operation-node transformer 30488             |

These authentication packages implement server authentication and passkey verification.
Disabling telemetry does not make its imported constants disappear. No compiler, test
runner, browser driver, router devtools panel, or query devtools panel appears in the
server module inventory. Solid, Kobalte, icons, and message functions render SSR output;
their presence alone does not make them removable client-only code. The XLSX library is
an exception: the export happens in the browser, but Nitro traces its dynamic import.
A server-only guard in `toXlsx` removes that import from Nitro's trace. Its browser
implementation and downloaded spreadsheet stay unchanged. The server size falls
6,629,149 → 6,486,287 bytes (142,862 bytes, 2.2%). Two old/new pairs of `bun run perf`
repeat these counts; every client route and CSS count stays identical. The final server
has no `write-excel-file` or `fflate` modules. The existing XLSX export tests pass.

An explicit SSR guard also removes the weather renderer's dynamic import from Nitro's
trace. `onMount` alone did not remove it. Two alternating old/new pairs repeat
6,486,287 → 6,456,719 bytes (29,568 saved), with identical client budgets. The final
server has no weather renderer/shaders, XLSX, or compression-library modules. Both guards
are local build-time conditions; neither introduces a loader or package alias. Total
server saving from the original build is 171,471 bytes (2.6%).

## Checked and left as is

- **Duplication:** 0 module IDs with nonzero rendered length in multiple client chunks.
  Shared helpers have one chunk each. SSR and client copies are separate targets, not
  duplicate downloads. No manual chunk configuration added.
- **Better Auth:** the shared auth-client chunk is 17,592 bytes gzipped. Passkey's client
  contributes 5,041 rendered bytes; the organization error table contributes 5,165.
  Sign-in needs passkeys; every app page can offer the passkey prompt. Organization actions
  belong to Organization, create-organization, and invitation. The header's sign-out and
  the shared error boundary still bring the auth client into the entry. Splitting client
  instances would add session stores to save the organization table, about 1% of a route's
  gzipped JS.
- **Paraglide:** messages are split by module and tree-shaken, with both `en` and `et` in
  each used message. The main page chunks contain: timer 94 messages / 37,778 rendered
  bytes; reports 108 / 45,337; settings 67 / 30,168; projects 66 / 30,133;
  organization 96 / 48,093; sign-in methods 14 / 5,768. The entry has 43 / 17,853.
  Shared UI and error messages also load on each page. Active-locale-only loading is not
  implemented: the cookie selects the locale at runtime, Settings switches it without a
  reload, and report exports explicitly use English. The `et` half of a page's messages is
  an estimated 2 to 3% of its gzipped JS, under the task's 5% bar for an app-wide locale
  loader, so none was added.
- **Devtools:** no router or query panel in production. The router's production stub is
  149 rendered bytes. TanStack Form retains its event client (6,713 rendered bytes),
  because FormApi imports and invokes it unconditionally. Removing it would need an
  upstream production guard or a package patch. No alias or fake event-client module added,
  and it isn't worth raising upstream for this app alone.
- **Kobalte and Lucide:** 217,792 and 34,451 rendered bytes respectively across the client
  build, from the used component chunks and icon files. No whole icon registry appears.
  Floating UI is shared once. No substitute component library or icon system introduced.
- **Modulepreloads:** the manifest uses the root and matched route chain. It does not
  preload other page chunks or the XLSX dynamic import. The root does preload scenery
  fields and app-frame controls on sign-in/legal pages: the shared error/not-found
  components can render either frame, and the header includes appearance controls.
  Removing those links without removing the static imports would still fetch the code.
  The lazy renderer has no static runtime dependencies, so it adds no preload nodes.
- **Server cold start:** not measured. The server bundle is 2.6% smaller, but that shows
  bytes, not a faster cold start on Vercel; nothing here claims one.
- **Dropped weather split:** importing the defaults from `weather.ts` back into the
  renderer produced 229,005-byte reports JS and 227,558-byte sign-in JS. It also added
  three DOM elements on sign-in (156 → 159), failing the page budget. Moving renderer-only
  defaults with the renderer gives the retained numbers above and restores all DOM counts.

Validation: `bun run test` (396 Bun tests, 175 component tests), lint, `format:check`,
`tsc --noEmit`, knip, `bun run perf`, two alternating pairs of `perf:pages`, and all 75
weather golden frames pass. On 2026-09-30 Kait checked the weather's onset on a cold
`/sign-in` and toggling it in Settings while the renderer loads; both behave.

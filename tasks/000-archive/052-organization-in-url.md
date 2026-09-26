# 052: Each tab's organization comes from its URL

Status: done

The app shows the session's active organization, which every tab shares. A switch in one
tab moved the others, so task 049 added a server refusal (`ORGANIZATION_CHANGED`), a
session re-read, cache surgery when a tab noticed, and a notice above the page. Task 048
added another re-read for a session cookie that lagged behind its saved organization.
All of this exists because the organization lives in the session, not in the tab.

Put it in the URL instead: `/<slug>/timer`, `/<slug>/reports`, and so on. Each
organization-scoped server call names its organization, and the server checks that the
user is a member and acts on that one. Tabs then never disagree with the server, and
two organizations can stay open side by side.

## Approach

- Routes: `src/routes/_app.tsx` becomes `src/routes/$org.tsx`, and the pages move to
  `src/routes/$org/`. Its `beforeLoad` finds the organization by slug in
  `session.organizations` and puts it in the route context. Slugs never change after
  creation, so they're safe in links. Settings moves too, because the frame needs an
  organization.
- Old links (`/timer`, bookmarks, sign-in `redirect`s, the installed app's start URL):
  when `$org` is a page name rather than a slug, `beforeLoad` redirects to the same
  page in the default organization. The default is the one the session last used,
  which `getAppSession` still keeps. An unknown slug goes to `/`, which redirects to
  the default organization's timer.
- Slugs can't take a top-level path or a page name (`sign-in`, `timer`, and so on).
  The create-organization schema refuses them, and so does a Better Auth hook on the
  server.
- Server: `scopeMiddleware` has its own input validator, which checks `organizationId`
  and passes the input on unchanged (a valibot `looseObject` fails Start's serializable
  check). Start runs it on the raw input before the function's own schema, and merges the
  types, so every scoped call must name the organization. The middleware
  calls `resolveScope(db, userId, organizationId)`, which checks membership.
  `resolveSessionScope`, its re-read, the client part, and `ORGANIZATION_CHANGED` go.
- Client: query functions pass the organization id they already hold in their key.
- Switching organization is a link to the same page under the other slug. It also sets
  the session's active organization, but doesn't wait for it, so new tabs and `/` open
  there. No cache is dropped: each organization's keys hold its own data.
- Delete: `callInShownOrganization`, `shownOrganization`, `forgetOrganization`,
  `switchedFrom`/`switchedHere`, the organization branch of `followSession`,
  `OrganizationNotice` and its messages. `followSession` keeps resetting the cache when
  the session turns out to be another user's.
- The head script's intro check matches the new app paths.
- Docs: rewrite the Tenancy section of `docs/architecture.md`. The "Rejected: each tab
  keeping its own organization" entry becomes the decision.

## Acceptance criteria

- [x] App pages live under `/<slug>/`; old paths redirect there, keeping the search.
- [x] Two tabs on two organizations each read and write their own, with no notice and
      no refusal.
- [x] Every organization-scoped server function takes `organizationId`, and the server
      refuses one the user isn't a member of.
- [x] The code listed under "Delete" is gone; tests cover the new middleware input and
      the redirects.
- [x] Reserved slugs are refused when creating an organization.
- [x] `docs/architecture.md` records the decision.

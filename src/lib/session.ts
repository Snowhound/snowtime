import { type Query, type QueryClient, queryOptions } from '@tanstack/solid-query'
import { redirect } from '@tanstack/solid-router'
import { type AppSession, getAppSession } from '~/server/auth/auth.functions'
import { APP_PAGES, isAppPage } from './app-paths'
import { DEVICE_SETTINGS_KEY } from './device-settings'
import { INTRO_PENDING_TIMEOUT, INTRO_SEASON_KEY, INTRO_SEEN_KEY } from './intro'
import { seasonByMonth } from './scene'

// The signed-in user, their organizations and settings, or null when signed out. The root
// route loads it before every page; changes to the session (switching organization,
// signing out, saving the theme) update or invalidate this query. Its active organization is
// only the default for `/` and old links: each tab shows the organization in its URL.
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: () => getAppSession(),
})

function isSession(query: Query) {
  return query.queryKey[0] === sessionQuery.queryKey[0]
}

// The user whose data each client's cache holds, once known.
const cachedUser = new WeakMap<QueryClient, string>()

// Keeps one user's data in the cache. Signing out here loads a new page (signOut in
// src/lib/auth-client.ts), but a sign-out in another tab, or an expired session, leaves the
// data behind, and many keys hold only the organization: projects, teams, members, and
// reports show what the user may see. When the session turns out to be another user's, every
// other query starts over: those in use load again as the new user, and the rest lose their
// data. The root's query client calls this once.
export function followSession(queryClient: QueryClient) {
  return queryClient.getQueryCache().subscribe(({ query }) => {
    if (!isSession(query)) return
    const session = query.state.data as AppSession | null | undefined
    if (!session) return
    const previous = cachedUser.get(queryClient)
    cachedUser.set(queryClient, session.user.id)
    if (previous && previous !== session.user.id) {
      void queryClient.resetQueries({ predicate: (other) => !isSession(other) })
    }
  })
}

// The season of each month, for the head script.
const MONTH_SEASONS = Array.from({ length: 12 }, (_, month) => seasonByMonth(new Date(2000, month)))

// The signed-in pages, /<slug>/<page>, where the intro plays once a season (src/routes/$org/).
const APP_PATHS = new RegExp(`^/[^/]+/(${APP_PAGES.join('|')})(/|$)`)

// Runs in <head> before the body paints. Signed in, the server renders the theme setting as
// data-theme on <html>; signed out it renders none, and the theme saved on this device applies
// (src/lib/device-settings.ts) until the root sets data-theme from it after hydration. This
// applies the `dark` class, resolving "system" with the browser's preference, and follows later
// changes to either.
//
// When the intro is due on this page by the device's settings (src/lib/intro.ts), it marks
// <html data-intro="pending">, which paints the page black until the intro starts; the frame
// clears it if the account's settings say otherwise, and a timeout clears it if nothing mounts.
// While <html> has data-intro, the page is dark.
export const themeScript = `(() => {
  const root = document.documentElement
  const dark = matchMedia('(prefers-color-scheme: dark)')
  let stored = {}
  try {
    stored = JSON.parse(localStorage.getItem(${JSON.stringify(DEVICE_SETTINGS_KEY)}) ?? '{}') ?? {}
  } catch {}
  try {
    const path = location.pathname
    const where = path === '/sign-in' ? 'sign-in' : ${APP_PATHS}.test(path) ? 'app' : null
    const due =
      where &&
      stored.sceneIntro !== false &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      (where === 'app'
        ? localStorage.getItem(${JSON.stringify(INTRO_SEASON_KEY)}) !== ${JSON.stringify(MONTH_SEASONS)}[new Date().getMonth()]
        : localStorage.getItem(${JSON.stringify(INTRO_SEEN_KEY)}) !== '1')
    if (due) {
      root.dataset.intro = 'pending'
      setTimeout(() => root.dataset.intro === 'pending' && delete root.dataset.intro, ${INTRO_PENDING_TIMEOUT})
    }
  } catch {}
  const theme = () => root.dataset.theme ?? stored.theme
  const apply = () =>
    root.classList.toggle('dark', root.dataset.intro !== undefined || theme() === 'dark' || (theme() !== 'light' && dark.matches))
  apply()
  dark.addEventListener('change', apply)
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-intro'] })
})()`

// The organization `/` and old links open: the session's active one, which getAppSession
// keeps valid. Null for a user without an organization.
export function defaultOrganization(session: AppSession) {
  return session.organizations.find((o) => o.id === session.activeOrganizationId) ?? null
}

// Where a signed-in user without an organization goes: to their invitation, or to create one.
export function withoutOrganization(session: AppSession) {
  return session.invitationId
    ? redirect({ to: '/invitation/$id', params: { id: session.invitationId } })
    : redirect({ to: '/create-organization' })
}

// The organization /<slug>/... names, for a signed-in user. An old link to a page (/timer,
// with `href` its path, search, and hash) opens it in the default organization, and an unknown
// slug goes home, which opens the default organization's timer. Throws the redirect.
export function organizationOfPath(session: AppSession, slug: string, href: string) {
  const fallback = defaultOrganization(session)
  if (!fallback) throw withoutOrganization(session)
  if (isAppPage(slug)) throw redirect({ href: `/${fallback.slug}${href}` })
  const organization = session.organizations.find((o) => o.slug === slug)
  if (!organization) throw redirect({ to: '/' })
  return organization
}

// One of the user's organizations by id, as the session lists it now: a rename shows at once.
export function organizationIn(session: AppSession, organizationId: string) {
  return session.organizations.find((o) => o.id === organizationId)
}

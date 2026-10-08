import { type Query, type QueryClient, queryOptions } from '@tanstack/solid-query'
import { redirect } from '@tanstack/solid-router'
import { getAppSession } from '~/lib/api/auth'
import { isAppPage } from '~/lib/app-paths'
import type { AppSession } from '~/server/auth/auth.schemas'
import { clearPending } from './refusal'

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
    if (session === null) clearPending(queryClient)
    if (!session) return
    const previous = cachedUser.get(queryClient)
    cachedUser.set(queryClient, session.user.id)
    if (previous && previous !== session.user.id) {
      clearPending(queryClient)
      void queryClient.resetQueries({ predicate: (other) => !isSession(other) })
    }
  })
}

// The organization `/` and old links open: the session's active one, or the first by name
// when it has none or one the user has left. Null for a user without an organization.
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

export function isAdmin(role: string | undefined) {
  return role === 'owner' || role === 'admin'
}

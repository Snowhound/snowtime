import { QueryClient, QueryObserver } from '@tanstack/solid-query'
import { describe, expect, test, vi } from 'vitest'
import { newId } from './query'
import { followSession, organizationOfPath, sessionQuery } from './session'

vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: vi.fn() }))

const organizationId = newId()
const projectsKey = ['projects', organizationId]

// The session of one user, as far as the cache watcher reads it.
function sessionOf(userId: string, activeOrganizationId = organizationId) {
  return { user: { id: userId }, activeOrganizationId } as never
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  followSession(queryClient)
  return queryClient
}

describe('followSession', () => {
  test('another user’s session drops what the last one left, and reloads what is in use', async () => {
    const queryClient = setup()
    const ada = newId()
    const ben = newId()
    // The server answers for whoever the session belongs to.
    let signedIn = ada
    const projects = { [ada]: ['Everything Ada sees'], [ben]: ['What Ben sees'] }
    queryClient.setQueryData(sessionQuery.queryKey, sessionOf(ada))
    await queryClient.fetchQuery({ queryKey: ['teams', organizationId], queryFn: () => ['Ada’s'] })
    const observer = new QueryObserver(queryClient, {
      queryKey: projectsKey,
      queryFn: () => projects[signedIn],
    })
    const unsubscribe = observer.subscribe(() => {})
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(projects[ada]))

    // Ada signs out in another tab, or her session expires, and Ben signs in there.
    queryClient.setQueryData(sessionQuery.queryKey, null)
    signedIn = ben
    queryClient.setQueryData(sessionQuery.queryKey, sessionOf(ben))

    expect(queryClient.getQueryData(['teams', organizationId])).toBeUndefined()
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(projects[ben]))
    unsubscribe()
  })

  test('keeps the data of the same user', () => {
    const queryClient = setup()
    const ada = newId()
    queryClient.setQueryData(sessionQuery.queryKey, sessionOf(ada))
    queryClient.setQueryData(projectsKey, ['Ada’s'])
    queryClient.setQueryData(sessionQuery.queryKey, sessionOf(ada))
    expect(queryClient.getQueryData(projectsKey)).toEqual(['Ada’s'])
  })

  // Each tab shows the organization in its URL, so another tab's switch leaves this one's
  // data alone.
  test('keeps every organization’s data when the session’s default changes', () => {
    const queryClient = setup()
    const ada = newId()
    queryClient.setQueryData(sessionQuery.queryKey, sessionOf(ada))
    queryClient.setQueryData(projectsKey, ['Ada’s'])
    queryClient.setQueryData(sessionQuery.queryKey, sessionOf(ada, newId()))
    expect(queryClient.getQueryData(projectsKey)).toEqual(['Ada’s'])
  })
})

describe('organizationOfPath', () => {
  const northwind = { id: newId(), name: 'Northwind', slug: 'northwind', role: 'member' }
  const harbor = { id: newId(), name: 'Harbor', slug: 'harbor', role: 'owner' }
  const session = {
    user: { id: newId() },
    activeOrganizationId: harbor.id,
    organizations: [harbor, northwind],
    invitationId: null,
  } as never

  // The redirect organizationOfPath throws, as the router reads it.
  function redirected(slug: string, href: string, from = session) {
    try {
      organizationOfPath(from, slug, href)
    } catch (thrown) {
      return (thrown as { options: object }).options
    }
    throw new Error('no redirect')
  }

  test('names the organization of a slug the user belongs to', () => {
    expect(organizationOfPath(session, 'northwind', '/northwind/timer')).toBe(northwind)
  })

  test('opens an old link in the default organization, keeping the search and hash', () => {
    expect(redirected('reports', '/reports?range=last-week#top')).toMatchObject({
      href: '/harbor/reports?range=last-week#top',
    })
    expect(redirected('timer', '/timer')).toMatchObject({ href: '/harbor/timer' })
  })

  test('sends an unknown slug home', () => {
    expect(redirected('elsewhere', '/elsewhere/timer')).toMatchObject({ to: '/' })
  })

  test('sends a user without an organization to their invitation, or to create one', () => {
    const none = { ...(session as object), organizations: [], activeOrganizationId: null }
    expect(redirected('timer', '/timer', none as never)).toMatchObject({
      to: '/create-organization',
    })
    const invited = { ...none, invitationId: 'invitation' }
    expect(redirected('northwind', '/northwind/timer', invited as never)).toMatchObject({
      to: '/invitation/$id',
      params: { id: 'invitation' },
    })
  })
})

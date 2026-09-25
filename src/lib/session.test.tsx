import { QueryClient, QueryObserver } from '@tanstack/solid-query'
import { describe, expect, test, vi } from 'vitest'
import { getAppSession } from '~/server/auth/auth.functions'
import { AppError } from '~/server/errors'
import { newId } from './query'
import {
  callInShownOrganization,
  followSession,
  forgetSignedInUser,
  sessionQuery,
  shownOrganization,
} from './session'

vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: vi.fn() }))

const organizationId = newId()
const projectsKey = ['projects', organizationId]

// The session of one user, as far as the cache watcher reads it.
function sessionOf(userId: string) {
  return { user: { id: userId }, activeOrganizationId: organizationId } as never
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

  test('keeps the data of the same user, and of a user signed in after signing out here', async () => {
    const queryClient = setup()
    const ada = newId()
    queryClient.setQueryData(sessionQuery.queryKey, sessionOf(ada))
    queryClient.setQueryData(projectsKey, ['Ada’s'])
    queryClient.setQueryData(sessionQuery.queryKey, sessionOf(ada))
    expect(queryClient.getQueryData(projectsKey)).toEqual(['Ada’s'])

    forgetSignedInUser(queryClient)
    const ben = newId()
    queryClient.setQueryData(projectsKey, ['Ben’s, loaded as he signed in'])
    queryClient.setQueryData(sessionQuery.queryKey, sessionOf(ben))
    expect(queryClient.getQueryData(projectsKey)).toEqual(['Ben’s, loaded as he signed in'])
  })
})

describe('tabs sharing the session', () => {
  const max = newId()
  const harbor = newId()
  const northwind = newId()
  const projects = { [harbor]: ['Harbor’s project'], [northwind]: ['Northwind’s project'] }

  function sessionIn(activeOrganizationId: string) {
    return { user: { id: max }, activeOrganizationId } as never
  }

  // A tab on Harbor, with its session watched as the root watches it, and a server that
  // answers for the session's organization, which another tab can switch at any time. It
  // refuses a call for another organization, as scopeMiddleware does.
  function tabOnHarbor() {
    const queryClient = setup()
    const server = { active: harbor, refusals: 0 }
    vi.mocked(getAppSession).mockImplementation(async () => sessionIn(server.active))
    queryClient.setQueryData(sessionQuery.queryKey, sessionIn(harbor))
    const session = new QueryObserver(queryClient, { ...sessionQuery, staleTime: Infinity })
    const stopSession = session.subscribe(() => {})
    // Every value the cache stored under each organization's projects key.
    const stored: [unknown, unknown][] = []
    queryClient.getQueryCache().subscribe(({ query, type }) => {
      if (type === 'updated' && query.queryKey[0] === 'projects') {
        stored.push([query.queryKey[1], query.state.data])
      }
    })
    function listProjects(shown: string | undefined) {
      if (shown && shown !== server.active) {
        server.refusals++
        throw new AppError('ORGANIZATION_CHANGED', 'organization_changed')
      }
      return projects[server.active]
    }
    const list = new QueryObserver(queryClient, {
      queryKey: ['projects', harbor],
      queryFn: () => callInShownOrganization(queryClient, async (shown) => listProjects(shown)),
    })
    const stopList = list.subscribe(() => {})
    return {
      queryClient,
      server,
      list,
      stored,
      stop() {
        stopList()
        stopSession()
      },
    }
  }

  test('a call for the organization another tab left is refused, and the tab follows', async () => {
    const tab = tabOnHarbor()
    await vi.waitFor(() => expect(tab.list.getCurrentResult().data).toEqual(projects[harbor]))

    // Another tab switches to Northwind; this one still shows Harbor, and refetches.
    tab.server.active = northwind
    await tab.list.refetch()
    expect(tab.server.refusals).toBe(1)

    // It reads the session again, follows it to Northwind, and drops Harbor's queries.
    await vi.waitFor(() => expect(shownOrganization(tab.queryClient)).toBe(northwind))
    expect(tab.queryClient.getQueryCache().find({ queryKey: ['projects', harbor] })).toBeUndefined()
    expect(tab.stored).not.toContainEqual([harbor, projects[northwind]])
    tab.stop()
  })

  test('a session read again with another organization drops the old one’s queries', async () => {
    const tab = tabOnHarbor()
    await vi.waitFor(() => expect(tab.list.getCurrentResult().data).toEqual(projects[harbor]))
    tab.queryClient.setQueryData(['projects', northwind], projects[northwind])

    // The session refetches, on focus, after another tab switched.
    tab.server.active = northwind
    await tab.queryClient.refetchQueries({ queryKey: sessionQuery.queryKey })

    expect(shownOrganization(tab.queryClient)).toBe(northwind)
    expect(tab.queryClient.getQueryData(['projects', harbor])).toBeUndefined()
    expect(tab.queryClient.getQueryData(['projects', northwind])).toEqual(projects[northwind])
    tab.stop()
  })
})

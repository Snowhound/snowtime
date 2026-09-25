import { QueryClient, QueryObserver } from '@tanstack/solid-query'
import { describe, expect, test, vi } from 'vitest'
import { newId } from './query'
import { followSessionUser, forgetSignedInUser, sessionQuery } from './session'

vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: vi.fn() }))

const organizationId = newId()
const projectsKey = ['projects', organizationId]

// The session of one user, as far as the cache watcher reads it.
function sessionOf(userId: string) {
  return { user: { id: userId }, activeOrganizationId: organizationId } as never
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  followSessionUser(queryClient)
  return queryClient
}

describe('followSessionUser', () => {
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

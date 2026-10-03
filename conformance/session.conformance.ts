// The session and the signed-out reads on the contract (task 084), over HTTP, as
// timer.conformance.ts runs. The server runs with password sign-in on and no demo mode.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Transport } from '~/lib/api/client'
import { type OperationName, operations } from '~/lib/api/operations'
import { httpTransport } from '~/lib/api/transports'
import { requestOf } from '~/lib/api/wire'
import { COMPANY, USERS } from '../perf/lib/database'
import { refused, send as sendTo, type ServerUnderTest, serverUnderTest } from './server'

let server: ServerUnderTest
let headers: { admin: Record<string, string>; member: Record<string, string> }
let admin: Transport

beforeAll(async () => {
  server = await serverUnderTest()
  headers = { admin: await server.as('admin'), member: await server.as('member') }
  admin = httpTransport(server.url, headers.admin)
}, 120_000)
afterAll(() => server?.stop())

function send(name: OperationName, input: unknown, as = headers.admin) {
  return sendTo(server.url, name, input, as)
}

const organizationId = COMPANY.id

describe('the session', () => {
  test('signed out, the session is null', async () => {
    expect(await send('getAppSession', undefined, {})).toEqual({ status: 200, body: null })
  })

  test('signed in, it has the user, their organizations and settings, and the app URL', async () => {
    const session = (await admin('getAppSession', undefined))!
    expect(session.user.email).toBe(USERS.admin.email)
    expect(session.signedInAt).toBeInstanceOf(Date)
    expect(session.organizations).toContainEqual(
      expect.objectContaining({ id: organizationId, slug: COMPANY.slug, role: 'owner' }),
    )
    expect(session.activeOrganizationId).toBe(organizationId)
    expect(session.settings?.timeZone).toBe('Europe/Tallinn')
    expect(session.appUrl).toBe(new URL(server.url).origin)
  })

  test("reading it sets no language cookie, even in another language than the account's", async () => {
    const member = httpTransport(server.url, headers.member)
    await member('updateSettings', { locale: 'et' })
    const { path } = requestOf(operations.getAppSession, undefined)
    const response = await fetch(`${server.url}${path}`, {
      headers: { ...headers.member, 'accept-language': 'en' },
    })
    expect(response.status).toBe(200)
    expect(((await response.json()) as { settings: { locale: string } }).settings.locale).toBe('et')
    expect(
      response.headers.getSetCookie().filter((c) => c.startsWith('PARAGLIDE_LOCALE=')),
    ).toEqual([])
    await member('updateSettings', { locale: 'en' })
  })
})

describe('signed-out reads', () => {
  test('the sign-in methods, the deployment, and the seeded users', async () => {
    expect((await send('getSignInMethods', undefined, {})).body).toEqual(
      expect.arrayContaining(['password', 'passkey']),
    )
    expect(await send('getDeployment', undefined, {})).toEqual({
      status: 200,
      body: { demoMode: false, allowedDomains: [] },
    })
    const { body } = await send('getDevUsers', undefined, {})
    expect(body).toContainEqual({
      name: expect.any(String),
      email: USERS.admin.email,
      password: USERS.admin.password,
    })
  })
})

describe('issue links', () => {
  test('an admin sets and clears them, and the session shows them', async () => {
    const issueLinks = 'https://tracker.example.com/browse/{key}'
    expect(await admin('updateIssueLinks', { organizationId, issueLinks })).toEqual({
      id: organizationId,
      issueLinks,
    })
    const session = (await admin('getAppSession', undefined))!
    expect(session.organizations.find((o) => o.id === organizationId)?.issueLinks).toBe(issueLinks)
    expect(await admin('updateIssueLinks', { organizationId, issueLinks: '' })).toEqual({
      id: organizationId,
      issueLinks: null,
    })
  })

  test('a member may not set them, and an address without {key} is refused', async () => {
    expect(
      await send(
        'updateIssueLinks',
        { organizationId, issueLinks: 'https://tracker.example.com/{key}' },
        headers.member,
      ),
    ).toEqual({ status: 403, body: refused('FORBIDDEN', 'organization_forbidden') })
    expect(
      (await send('updateIssueLinks', { organizationId, issueLinks: 'https://example.com/' }))
        .status,
    ).toBe(400)
  })
})

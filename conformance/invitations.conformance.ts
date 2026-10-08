// Invitations on the contract (task 084), over HTTP, as timer.conformance.ts runs. Better
// Auth creates and accepts them; its refusals keep its status and code.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { v7 as uuidv7 } from 'uuid'
import { COMPANY, USERS } from '../perf/lib/database'
import { companyIds } from '../src/db/seed-company'
import {
  type Caller,
  type CallName,
  caller,
  refused,
  send as sendTo,
  type ServerUnderTest,
  serverUnderTest,
} from './server'

let server: ServerUnderTest
let headers: { admin: Record<string, string>; member: Record<string, string> }
let admin: Caller

beforeAll(async () => {
  server = await serverUnderTest()
  headers = { admin: await server.as('admin'), member: await server.as('member') }
  admin = caller(server.url, headers.admin)
}, 120_000)
afterAll(() => server?.stop())

function send(name: CallName, input: unknown, as = headers.admin) {
  return sendTo(server.url, name, input, as)
}

const organizationId = COMPANY.id
const email = 'conformance@lumen.example.com'

describe('invitations', () => {
  test('an admin invites by address, and the link shows the invitation signed out', async () => {
    const { status, body } = await send('inviteMember', {
      organizationId,
      email,
      role: 'member',
      teamId: null,
    })
    expect(status).toBe(200)
    expect(Object.keys(body as object).toSorted()).toEqual(['email', 'expiresAt', 'id'])
    const { id } = body as { id: string }

    const open = await admin('listInvitations', { organizationId })
    expect(open.find((i) => i.id === id)).toMatchObject({ email, role: 'member', teamId: null })
    expect(await send('getInvitation', { id }, {})).toMatchObject({
      status: 200,
      body: { id, state: 'pending', email, organizationName: expect.any(String) },
    })
  })

  test('an unknown link shows nothing', async () => {
    expect(await send('getInvitation', { id: uuidv7() }, {})).toEqual({ status: 200, body: null })
  })

  test('a member may not invite', async () => {
    expect(
      await send(
        'inviteMember',
        { organizationId, email: 'other@lumen.example.com', role: 'member', teamId: null },
        headers.member,
      ),
    ).toEqual({ status: 403, body: refused('FORBIDDEN', 'organization_forbidden') })
  })

  test("Better Auth's create refusal keeps its status and code", async () => {
    const { status, body } = await send('inviteMember', {
      organizationId,
      email: USERS.member.email,
      role: 'member',
      teamId: null,
    })
    expect(status).toBe(400)
    expect(body).toMatchObject({
      error: { code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION', message: expect.any(String) },
    })
  })

  test("Better Auth's acceptance refusal checks the recipient", async () => {
    const [invitation] = await admin('listInvitations', { organizationId })
    const accepted = await send('acceptInvitation', { id: invitation.id }, headers.member)
    expect(accepted.status).toBe(403)
    expect(accepted.body).toMatchObject({
      error: { code: 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION' },
    })
  })
})

test('a verified recipient accepts a team invitation and a repeated click is closed', async () => {
  const invitation = await admin('inviteMember', {
    organizationId,
    email: 'noah@example.com',
    role: 'member',
    teamId: companyIds.teams.design,
  })
  const response = await fetch(`${server.url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: server.url, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'noah@example.com', password: USERS.admin.password }),
  })
  expect(response.status).toBe(200)
  const recipient = {
    origin: server.url,
    cookie: response.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; '),
  }
  expect(await send('acceptInvitation', { id: invitation.id }, recipient)).toEqual({
    status: 200,
    body: { id: invitation.id },
  })
  expect(await send('getInvitation', { id: invitation.id }, {})).toEqual({
    status: 200,
    body: { id: invitation.id, state: 'closed' },
  })
  expect(await send('acceptInvitation', { id: invitation.id }, recipient)).toMatchObject({
    status: 400,
    body: { error: { code: 'INVITATION_NOT_FOUND' } },
  })
  const session = await caller(server.url, recipient)('getAppSession', undefined)
  expect(session?.activeOrganizationId).toBe(organizationId)
  const teams = await caller(server.url, recipient)('listTeams', { organizationId })
  const joined = teams.find((t) => t.id === companyIds.teams.design)
  expect(joined?.members.some((m) => m.userId === session?.user.id)).toBe(true)
})

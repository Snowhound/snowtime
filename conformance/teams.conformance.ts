// Teams and members on the contract (task 084), over HTTP, as timer.conformance.ts runs.
// The admin is the Lumen Works owner; the member is Liis, a plain member of Design.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { companyIds } from '~/db/seed-company'
import { COMPANY, USERS } from '../perf/lib/database'
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
const design = companyIds.teams.design

async function memberId() {
  const members = await admin('listMembers', { organizationId })
  return members.find((m) => m.email === USERS.member.email)!.userId
}

describe('members and teams', () => {
  test('the members list each with their role and teams', async () => {
    const members = await admin('listMembers', { organizationId })
    const owner = members.find((m) => m.email === USERS.admin.email)!
    expect(owner.orgRole).toBe('owner')
    expect(owner.joinedAt).toBeInstanceOf(Date)
    const member = members.find((m) => m.email === USERS.member.email)!
    expect(member).toMatchObject({ orgRole: 'member', teams: [{ teamId: design, role: 'member' }] })
  })

  test('the teams list each with its members and their team roles', async () => {
    const teams = await admin('listTeams', { organizationId })
    const names = teams.map((t) => t.name)
    expect(names).toEqual(names.toSorted((a, b) => a.localeCompare(b)))
    const team = teams.find((t) => t.id === design)!
    expect(team.members).toContainEqual({ userId: await memberId(), role: 'member' })
  })

  test('a member may not change teams', async () => {
    expect(await send('createTeam', { organizationId, name: 'Mine' }, headers.member)).toEqual({
      status: 403,
      body: refused('FORBIDDEN', 'teams_forbidden'),
    })
  })

  test('a team is created, renamed, given a lead, and deleted', async () => {
    const created = await admin('createTeam', { organizationId, name: 'Conformance' })
    expect(created).toEqual({ id: expect.any(String), name: 'Conformance' })
    expect(await send('createTeam', { organizationId, name: 'Conformance' })).toEqual({
      status: 409,
      body: refused('CONFLICT', 'team_name_taken'),
    })
    const teamId = created.id
    expect(await admin('renameTeam', { organizationId, teamId, name: 'Checks' })).toEqual({
      id: teamId,
      name: 'Checks',
    })

    const userId = await memberId()
    expect(await admin('addTeamMember', { organizationId, teamId, userId })).toEqual({
      teamId,
      userId,
    })
    expect(await admin('setTeamRole', { organizationId, teamId, userId, role: 'lead' })).toEqual({
      teamId,
      userId,
      role: 'lead',
    })
    const teams = await admin('listTeams', { organizationId })
    expect(teams.find((t) => t.id === teamId)).toEqual({
      id: teamId,
      name: 'Checks',
      members: [{ userId, role: 'lead' }],
    })

    expect(await admin('removeTeamMember', { organizationId, teamId, userId })).toEqual({
      teamId,
      userId,
    })
    expect(await send('removeTeamMember', { organizationId, teamId, userId })).toEqual({
      status: 404,
      body: refused('NOT_FOUND', 'team_member_not_found'),
    })
    expect(await admin('deleteTeam', { organizationId, teamId })).toEqual({ id: teamId })
    expect(await send('deleteTeam', { organizationId, teamId })).toEqual({
      status: 404,
      body: refused('NOT_FOUND', 'team_not_found'),
    })
  })
})

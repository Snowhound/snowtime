// Tenancy across organizations, over HTTP. Adam is an admin of Northwind and the owner of
// Harbor (src/db/seed.ts). Acting under Northwind with Harbor's entry, project, team, and
// member IDs, each call is refused, mostly as if the ID didn't exist, and changes nothing in
// Harbor.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SEED_PASSWORD, seedIds } from '~/db/seed'
import {
  type CallName,
  caller,
  refused,
  send as sendTo,
  type ServerUnderTest,
  serverUnderTest,
} from './server'

let server: ServerUnderTest
let adam: Record<string, string>

const northwind = seedIds.orgs.northwind
const harbor = seedIds.orgs.harbor
const entry = seedIds.entries.harbor
const project = seedIds.projects.audit
const team = seedIds.teams.delivery
const mia = seedIds.users.engineer

async function signIn(email: string) {
  const response = await fetch(`${server.url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: server.url },
    body: JSON.stringify({ email, password: SEED_PASSWORD }),
  })
  if (!response.ok) throw new Error(`Sign-in as ${email}: ${response.status}`)
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .join('; ')
  return { cookie, origin: server.url }
}

beforeAll(async () => {
  server = await serverUnderTest()
  adam = await signIn('admin@example.com')
}, 120_000)
afterAll(() => server?.stop())

function at(hours: number) {
  return new Date(Date.UTC(2026, 8, 29, hours)).toISOString()
}

function notFound(key: string) {
  return { status: 404, body: refused('NOT_FOUND', key) }
}

function send(name: CallName, input: unknown) {
  return sendTo(server.url, name, input, adam)
}

async function auth(path: string, body: unknown) {
  const response = await fetch(`${server.url}/api/auth${path}`, {
    method: 'POST',
    headers: { ...adam, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as unknown }
}

// Harbor's rows as its owner sees them, to show a refused call changed nothing.
async function harborState() {
  const as = caller(server.url, adam)
  return {
    entries: await as('listEntries', {
      organizationId: harbor,
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
    }),
    projects: await as('listProjects', { organizationId: harbor, includeArchived: true }),
    teams: await as('listTeams', { organizationId: harbor }),
    members: await as('listMembers', { organizationId: harbor }),
  }
}

describe("another organization's IDs", () => {
  test('are refused and change nothing there', async () => {
    const before = await harborState()
    const memberId = before.members.find((m) => m.userId === mia)!.memberId
    const id = '01900000-0000-7000-8000-00000000ffff'
    const report = { organizationId: northwind, from: '2026-09-01', to: '2026-10-01' }

    const answers = {
      updateEntry: await send('updateEntry', {
        organizationId: northwind,
        id: entry,
        description: 'Moved',
      }),
      deleteEntry: await send('deleteEntry', { organizationId: northwind, id: entry }),
      createEntryWithProject: await send('createEntry', {
        organizationId: northwind,
        id,
        projectId: project,
        startedAt: at(8),
        stoppedAt: at(9),
      }),
      startTimerWithProject: await send('startTimer', {
        organizationId: northwind,
        id,
        projectId: project,
      }),
      updateProject: await send('updateProject', {
        organizationId: northwind,
        id: project,
        name: 'Moved',
      }),
      archiveProject: await send('archiveProject', { organizationId: northwind, id: project }),
      deleteProject: await send('deleteProject', { organizationId: northwind, id: project }),
      assignProjectToTeam: await send('assignProjectToTeam', {
        organizationId: northwind,
        projectId: seedIds.projects.internal,
        teamId: team,
      }),
      renameTeam: await send('renameTeam', { organizationId: northwind, teamId: team, name: 'X' }),
      deleteTeam: await send('deleteTeam', { organizationId: northwind, teamId: team }),
      addTeamMember: await send('addTeamMember', {
        organizationId: northwind,
        teamId: team,
        userId: mia,
      }),
      setTeamRole: await send('setTeamRole', {
        organizationId: northwind,
        teamId: team,
        userId: mia,
        role: 'member',
      }),
      removeTeamMember: await send('removeTeamMember', {
        organizationId: northwind,
        teamId: team,
        userId: mia,
      }),
      reportOfTeam: await send('getReport', { ...report, teamId: team }),
      updateMemberRole: await auth('/organization/update-member-role', {
        organizationId: northwind,
        memberId,
        role: 'admin',
      }),
      removeMember: await auth('/organization/remove-member', {
        organizationId: northwind,
        memberIdOrEmail: memberId,
      }),
    }
    const project404 = notFound('project_not_found')
    const team404 = notFound('team_not_found')
    expect(answers).toEqual({
      updateEntry: notFound('entry_not_found'),
      deleteEntry: notFound('entry_not_found'),
      createEntryWithProject: project404,
      startTimerWithProject: project404,
      updateProject: project404,
      archiveProject: project404,
      deleteProject: project404,
      assignProjectToTeam: team404,
      renameTeam: team404,
      deleteTeam: team404,
      addTeamMember: team404,
      setTeamRole: team404,
      removeTeamMember: team404,
      reportOfTeam: team404,
      updateMemberRole: {
        status: 403,
        body: {
          code: 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER',
          message: 'You are not allowed to update this member',
        },
      },
      removeMember: {
        status: 400,
        body: { code: 'MEMBER_NOT_FOUND', message: 'Member not found' },
      },
    })
    // A report filter isn't refused: another organization's project matches no time here.
    const filtered = await send('getReport', { ...report, projectId: project })
    expect(filtered).toMatchObject({
      status: 200,
      body: { total: 0, entries: 0, members: [], projects: [], teams: [] },
    })
    expect(await harborState()).toEqual(before)
  })
})

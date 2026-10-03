// Projects on the contract (task 084), over HTTP, as timer.conformance.ts runs. The admin is
// the Lumen Works owner; the member is Liis, a plain member of Design.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { v7 as uuidv7 } from 'uuid'
import { companyIds } from '~/db/seed-company'
import type { Transport } from '~/lib/api/client'
import type { OperationName } from '~/lib/api/operations'
import { httpTransport } from '~/lib/api/transports'
import { COMPANY } from '../perf/lib/database'
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
const id = uuidv7()
const teamId = companyIds.teams.design

async function listed(includeArchived?: boolean) {
  const projects = await admin('listProjects', { organizationId, includeArchived })
  return projects.find((p) => p.id === id)
}

describe('projects', () => {
  test('the list sends only the contract fields, archived projects on request', async () => {
    const { status, body } = await send('listProjects', { organizationId, includeArchived: true })
    expect(status).toBe(200)
    const projects = body as Record<string, unknown>[]
    expect(Object.keys(projects[0]).toSorted()).toEqual(
      ['archivedAt', 'color', 'hasEntries', 'id', 'name', 'teamIds'].toSorted(),
    )
    const active = await admin('listProjects', { organizationId })
    expect(active.length).toBeLessThan(projects.length)
    expect(active.every((p) => p.archivedAt === null)).toBe(true)
  })

  test('a member may not create projects', async () => {
    expect(
      await send('createProject', { organizationId, id: uuidv7(), name: 'Mine' }, headers.member),
    ).toEqual({ status: 403, body: refused('FORBIDDEN', 'projects_forbidden') })
  })

  test('a project is created, edited, archived, assigned, and deleted', async () => {
    const { status, body } = await send('createProject', {
      organizationId,
      id,
      name: ' Conformance ',
      color: '#112233',
    })
    expect({ status, body }).toEqual({
      status: 200,
      body: { id, name: 'Conformance', color: '#112233', archivedAt: null },
    })
    expect(
      await send('createProject', { organizationId, id: uuidv7(), name: 'Conformance' }),
    ).toEqual({ status: 409, body: refused('CONFLICT', 'project_name_taken') })
    expect(await admin('updateProject', { organizationId, id, color: '#445566' })).toEqual({
      id,
      name: 'Conformance',
      color: '#445566',
      archivedAt: null,
    })

    const archived = await admin('archiveProject', { organizationId, id })
    expect(archived.archivedAt).toBeInstanceOf(Date)
    expect(await listed()).toBeUndefined()
    expect((await listed(true))?.archivedAt).toEqual(archived.archivedAt)
    expect((await admin('unarchiveProject', { organizationId, id })).archivedAt).toBeNull()

    expect(await admin('assignProjectToTeam', { organizationId, projectId: id, teamId })).toEqual({
      projectId: id,
      teamId,
    })
    expect(await listed()).toMatchObject({ teamIds: [teamId], hasEntries: false })
    await admin('unassignProjectFromTeam', { organizationId, projectId: id, teamId })
    expect((await listed())?.teamIds).toEqual([])

    expect(await admin('deleteProject', { organizationId, id })).toEqual({ id })
    expect(await send('deleteProject', { organizationId, id })).toEqual({
      status: 404,
      body: refused('NOT_FOUND', 'project_not_found'),
    })
  })

  test('a project with entries is not deleted', async () => {
    const used = (await admin('listProjects', { organizationId })).find((p) => p.hasEntries)!
    expect(await send('deleteProject', { organizationId, id: used.id })).toEqual({
      status: 409,
      body: refused('CONFLICT', 'project_has_entries'),
    })
  })
})

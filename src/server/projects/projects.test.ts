/// <reference types="bun" />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '~/db'
import { project, projectTeam, timeEntry } from '~/db/schema'
import { seedIds } from '~/db/seed'
import { limits } from '../limits.server'
import { failedConstraint } from '../queries.server'
import type { Scope } from '../scope.server'
import { as, createSeededDatabase, scopeOf } from '../testing'
import {
  archiveProject,
  assertUsableProject,
  assignProjectToTeam,
  createProject,
  deleteProject,
  listProjects,
  unarchiveProject,
  unassignProjectFromTeam,
  updateProject,
} from './projects.server'

const { users: U, orgs: O, projects: P, teams: T } = seedIds

let db: Database
let cleanup: () => void
const scopes: Record<keyof typeof U, Scope> = {} as never

beforeAll(async () => {
  ;({ db, cleanup } = await createSeededDatabase(new Date('2026-09-23T12:00:00Z')))
  for (const [key, id] of Object.entries(U)) {
    scopes[key as keyof typeof U] = await scopeOf(db, id, O.northwind)
  }
})

afterAll(() => cleanup())

async function idsOf(scope: Scope, includeArchived = false) {
  return (await listProjects(db, scope, { includeArchived })).map((p) => p.id)
}

function newProject(scope: Scope, name: string) {
  return as(scope, () => createProject(db, scope, { id: uuidv7(), name, color: null }))
}

describe('listProjects', () => {
  test('members see unassigned projects and those of their teams', async () => {
    expect(await idsOf(scopes.member)).toEqual([P.internal, P.mobile, P.website])
    expect(await idsOf(scopes.lead)).toEqual([P.internal, P.website])
    expect(await idsOf(scopes.engineer)).toEqual([P.internal, P.mobile])
    expect(await idsOf(scopes.loner)).toEqual([P.internal])
  })

  test('admins and owners see every project, never deleted ones or other organizations', async () => {
    for (const scope of [scopes.admin, scopes.owner]) {
      expect(await idsOf(scope)).toEqual([P.internal, P.mobile, P.website])
      expect(await idsOf(scope, true)).toEqual([P.internal, P.legacy, P.mobile, P.website])
    }
  })

  test('archived projects only on request, with the same visibility', async () => {
    expect(await idsOf(scopes.engineer, true)).toEqual([P.internal, P.legacy, P.mobile])
    expect(await idsOf(scopes.lead, true)).toEqual([P.internal, P.website])
  })

  test('each project carries its team ids', async () => {
    const projects = await listProjects(db, scopes.admin, { includeArchived: true })
    expect(Object.fromEntries(projects.map((p) => [p.id, p.teamIds]))).toEqual({
      [P.internal]: [],
      [P.legacy]: [T.engineering],
      [P.mobile]: [T.engineering],
      [P.website]: [T.design],
    })
  })

  test('assertUsableProject follows the same visibility', async () => {
    await expect(assertUsableProject(db, scopes.lead, P.mobile)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(assertUsableProject(db, scopes.lead, P.legacy)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(assertUsableProject(db, scopes.engineer, P.legacy)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await assertUsableProject(db, scopes.loner, P.internal)
    await assertUsableProject(db, scopes.admin, P.mobile)
  })
})

describe('createProject', () => {
  test('admins and owners create projects; others are forbidden', async () => {
    for (const scope of [scopes.member, scopes.lead, scopes.engLead]) {
      await expect(newProject(scope, 'Not allowed')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    const created = await as(scopes.admin, () =>
      createProject(db, scopes.admin, { id: uuidv7(), name: '  Research ', color: '#AABBCC' }),
    )
    expect(created).toMatchObject({
      organizationId: O.northwind,
      color: '#AABBCC',
      createdBy: U.admin,
    })
    expect(await idsOf(scopes.loner)).toContain(created.id)
  })

  test('names are unique among non-deleted projects of the organization', async () => {
    await expect(newProject(scopes.owner, 'Internal')).rejects.toMatchObject({ code: 'CONFLICT' })
    // Deleted in Northwind, and "Audit" exists only in Harbor.
    await newProject(scopes.owner, 'Scrapped pitch')
    await newProject(scopes.owner, 'Audit')
  })

  test('a reused id is a conflict', async () => {
    const id = uuidv7()
    await as(scopes.owner, () =>
      createProject(db, scopes.owner, { id, name: 'First', color: null }),
    )
    await expect(
      as(scopes.owner, () => createProject(db, scopes.owner, { id, name: 'Second', color: null })),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('updateProject', () => {
  test('admins rename and recolor; the name stays unique', async () => {
    const created = await newProject(scopes.admin, 'Draft name')
    const updated = await as(scopes.admin, () =>
      updateProject(db, scopes.admin, { id: created.id, name: 'Final name', color: '#112233' }),
    )
    expect(updated).toMatchObject({ name: 'Final name', color: '#112233', updatedBy: U.admin })
    await expect(
      as(scopes.admin, () =>
        updateProject(db, scopes.admin, { id: created.id, name: 'Mobile app' }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  test('members cannot update; deleted and other organizations’ projects are not found', async () => {
    await expect(
      as(scopes.lead, () => updateProject(db, scopes.lead, { id: P.website, name: 'Mine' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    for (const id of [P.scrapped, P.audit]) {
      await expect(
        as(scopes.owner, () => updateProject(db, scopes.owner, { id, name: 'x' })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
  })
})

describe('archiveProject and unarchiveProject', () => {
  test('archiving hides the project from lists and new time; unarchiving restores it', async () => {
    const created = await newProject(scopes.owner, 'Seasonal')
    const archived = await as(scopes.owner, () =>
      archiveProject(db, scopes.owner, { id: created.id }),
    )
    expect(archived.archivedAt).toBeInstanceOf(Date)
    expect(await idsOf(scopes.member)).not.toContain(created.id)
    await expect(assertUsableProject(db, scopes.member, created.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    })

    const again = await as(scopes.owner, () => archiveProject(db, scopes.owner, { id: created.id }))
    expect(again.archivedAt).toEqual(archived.archivedAt)

    const restored = await as(scopes.admin, () =>
      unarchiveProject(db, scopes.admin, { id: created.id }),
    )
    expect(restored.archivedAt).toBeNull()
    expect(await idsOf(scopes.member)).toContain(created.id)
  })

  test('only admins and owners archive or unarchive', async () => {
    await expect(
      as(scopes.engLead, () => archiveProject(db, scopes.engLead, { id: P.mobile })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      as(scopes.engLead, () => unarchiveProject(db, scopes.engLead, { id: P.legacy })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('assignProjectToTeam and unassignProjectFromTeam', () => {
  test('assigning restricts visibility to the team; unassigning the last team opens it again', async () => {
    const created = await newProject(scopes.admin, 'Brand book')
    expect(await idsOf(scopes.engineer)).toContain(created.id)

    const assignment = { projectId: created.id, teamId: T.design }
    await as(scopes.admin, () => assignProjectToTeam(db, scopes.admin, assignment))
    await as(scopes.admin, () => assignProjectToTeam(db, scopes.admin, assignment))
    expect(await idsOf(scopes.engineer)).not.toContain(created.id)
    expect(await idsOf(scopes.lead)).toContain(created.id)
    const [listed] = (await listProjects(db, scopes.admin, { includeArchived: false })).filter(
      (p) => p.id === created.id,
    )
    expect(listed.teamIds).toEqual([T.design])

    await as(scopes.owner, () => unassignProjectFromTeam(db, scopes.owner, assignment))
    await as(scopes.owner, () => unassignProjectFromTeam(db, scopes.owner, assignment))
    expect(await idsOf(scopes.engineer)).toContain(created.id)
  })

  test('only admins and owners assign; a team lead cannot assign to their own team', async () => {
    await expect(
      as(scopes.lead, () =>
        assignProjectToTeam(db, scopes.lead, { projectId: P.internal, teamId: T.design }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      as(scopes.lead, () =>
        unassignProjectFromTeam(db, scopes.lead, { projectId: P.website, teamId: T.design }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('teams and projects of another organization are not found', async () => {
    await expect(
      as(scopes.admin, () =>
        assignProjectToTeam(db, scopes.admin, { projectId: P.internal, teamId: T.delivery }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      as(scopes.admin, () =>
        assignProjectToTeam(db, scopes.admin, { projectId: P.audit, teamId: T.design }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      as(scopes.admin, () =>
        assignProjectToTeam(db, scopes.admin, { projectId: P.scrapped, teamId: T.design }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('deleteProject', () => {
  function logOn(projectId: string, deleted = false) {
    return as(scopes.admin, async () => {
      await db.insert(timeEntry).values({
        id: uuidv7(),
        organizationId: O.northwind,
        userId: U.admin,
        projectId,
        startedAt: new Date('2026-09-01T08:00:00Z'),
        stoppedAt: new Date('2026-09-01T09:00:00Z'),
        sysDeleted: deleted,
      })
    })
  }

  test('deletes the project and its team assignments, and frees the name', async () => {
    const created = await newProject(scopes.admin, 'Typo projekt')
    await as(scopes.admin, () =>
      assignProjectToTeam(db, scopes.admin, { projectId: created.id, teamId: T.design }),
    )
    // Deleted entries do not count as time on the project.
    await logOn(created.id, true)

    expect(
      await as(scopes.owner, () => deleteProject(db, scopes.owner, { id: created.id })),
    ).toEqual({
      id: created.id,
    })
    expect(await idsOf(scopes.admin, true)).not.toContain(created.id)
    expect(
      await db.select().from(projectTeam).where(eq(projectTeam.projectId, created.id)),
    ).toEqual([])
    await expect(
      as(scopes.owner, () => deleteProject(db, scopes.owner, { id: created.id })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const reused = await newProject(scopes.admin, 'Typo projekt')
    expect(reused.id).not.toBe(created.id)
  })

  test('a project with time on it is a conflict and stays as it was', async () => {
    const created = await newProject(scopes.admin, 'Used once')
    await as(scopes.admin, () =>
      assignProjectToTeam(db, scopes.admin, { projectId: created.id, teamId: T.design }),
    )
    await logOn(created.id)
    await expect(
      as(scopes.admin, () => deleteProject(db, scopes.admin, { id: created.id })),
    ).rejects.toMatchObject({ code: 'CONFLICT', key: 'project_has_entries' })
    const [kept] = (await listProjects(db, scopes.admin, { includeArchived: false })).filter(
      (p) => p.id === created.id,
    )
    expect(kept.teamIds).toEqual([T.design])
    await expect(
      as(scopes.admin, () => deleteProject(db, scopes.admin, { id: P.mobile })),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  test('the database refuses to delete a project with live entries', async () => {
    const created = await newProject(scopes.admin, 'Deleted by hand')
    await logOn(created.id)
    const write = as(scopes.admin, async () => {
      await db.update(project).set({ sysDeleted: true }).where(eq(project.id, created.id))
    })
    expect(await write.then(() => null, failedConstraint)).toBe('project_deleted_with_entries')
  })

  test('only admins and owners delete; other organizations’ projects are not found', async () => {
    const created = await newProject(scopes.admin, 'Not yours')
    for (const scope of [scopes.member, scopes.lead, scopes.engLead]) {
      await expect(
        as(scope, () => deleteProject(db, scope, { id: created.id })),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    for (const id of [P.audit, P.scrapped]) {
      await expect(
        as(scopes.admin, () => deleteProject(db, scopes.admin, { id })),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    }
  })
})

describe('project limit', () => {
  test('an organization at the limit refuses new projects', async () => {
    // Harbor, so the Northwind tests above keep their project lists.
    const harbor = await scopeOf(db, U.admin, O.harbor)
    const existing = await listProjects(db, harbor, { includeArchived: true })
    await as(harbor, async () => {
      await db.insert(project).values(
        Array.from({ length: limits.projectsPerOrganization - existing.length }, (_, i) => ({
          id: uuidv7(),
          organizationId: O.harbor,
          name: `Filler ${i}`,
        })),
      )
    })
    await expect(newProject(harbor, 'One too many')).rejects.toMatchObject({
      code: 'LIMIT_REACHED',
      key: 'project_limit',
    })
  })
})

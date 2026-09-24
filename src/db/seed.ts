// Demo data for the local database, and the fixtures tests seed their throwaway databases
// with. `bun run db:seed` runs it locally; tests call seed(db) directly and refer to rows
// through `seedIds`.
import { hashPassword } from 'better-auth/crypto'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '.'
import { SYSTEM_USER_ID, withActor } from './actor'
import {
  account,
  member,
  organization,
  project,
  projectTeam,
  team,
  teamMember,
  timeEntry,
  user,
  userSettings,
} from './schema'

// Every seeded user signs in with this password, locally only (docs/architecture.md,
// "Sign-in methods").
export const SEED_PASSWORD = 'snowtime-local'

// Fixed UUIDv7-shaped ids, so tests can name seeded rows.
const id = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`

export const seedIds = {
  users: {
    owner: id(0x101), // Olivia: owner of Northwind
    admin: id(0x102), // Adam: admin of Northwind, owner of Harbor
    lead: id(0x103), // Lena: leads Design
    member: id(0x104), // Max: Design and Engineering, also in Harbor
    engLead: id(0x105), // Theo: leads Engineering
    engineer: id(0x106), // Mia: Engineering, leads Delivery in Harbor
    loner: id(0x107), // Noah: Northwind, no team
  },
  orgs: { northwind: id(0x201), harbor: id(0x202) },
  teams: { design: id(0x301), engineering: id(0x302), delivery: id(0x303) },
  projects: {
    website: id(0x401), // Design
    mobile: id(0x402), // Engineering
    internal: id(0x403), // unassigned
    legacy: id(0x404), // Engineering, archived
    scrapped: id(0x405), // deleted
    onboarding: id(0x406), // Harbor, unassigned
    audit: id(0x407), // Harbor, Delivery
  },
  entries: {
    running: id(0x501), // Max, Northwind, website
    overnight: id(0x502), // Theo, crosses midnight UTC
    deleted: id(0x503), // Mia, deleted
    harbor: id(0x504), // Max, Harbor
  },
} as const

const U = seedIds.users
const P = seedIds.projects
const T = seedIds.teams
const O = seedIds.orgs

// Seeded users; the sign-in screen lists them in local development.
export const seedUsers = [
  { id: U.owner, name: 'Olivia Owner', email: 'owner@example.com', timeZone: 'Europe/Tallinn' },
  { id: U.admin, name: 'Adam Admin', email: 'admin@example.com', timeZone: 'Europe/Berlin' },
  { id: U.lead, name: 'Lena Lead', email: 'lead@example.com', timeZone: 'Europe/Tallinn' },
  { id: U.member, name: 'Max Member', email: 'member@example.com', timeZone: 'Europe/Tallinn' },
  { id: U.engLead, name: 'Theo Lead', email: 'theo@example.com', timeZone: 'America/New_York' },
  { id: U.engineer, name: 'Mia Engineer', email: 'mia@example.com', timeZone: 'Europe/Tallinn' },
  { id: U.loner, name: 'Noah Solo', email: 'noah@example.com', timeZone: 'Europe/London' },
]

const memberships: { org: string; user: string; role: string }[] = [
  { org: O.northwind, user: U.owner, role: 'owner' },
  { org: O.northwind, user: U.admin, role: 'admin' },
  { org: O.northwind, user: U.lead, role: 'member' },
  { org: O.northwind, user: U.member, role: 'member' },
  { org: O.northwind, user: U.engLead, role: 'member' },
  { org: O.northwind, user: U.engineer, role: 'member' },
  { org: O.northwind, user: U.loner, role: 'member' },
  { org: O.harbor, user: U.admin, role: 'owner' },
  { org: O.harbor, user: U.member, role: 'member' },
  { org: O.harbor, user: U.engineer, role: 'member' },
]

const teams = [
  { id: T.design, org: O.northwind, name: 'Design', lead: U.lead, members: [U.member] },
  {
    id: T.engineering,
    org: O.northwind,
    name: 'Engineering',
    lead: U.engLead,
    members: [U.member, U.engineer],
  },
  { id: T.delivery, org: O.harbor, name: 'Delivery', lead: U.engineer, members: [U.member] },
]

const projects = [
  {
    id: P.website,
    org: O.northwind,
    name: 'Website redesign',
    color: '#2a78d6',
    teams: [T.design],
  },
  { id: P.mobile, org: O.northwind, name: 'Mobile app', color: '#eb6834', teams: [T.engineering] },
  { id: P.internal, org: O.northwind, name: 'Internal', color: '#1baf7a', teams: [] },
  {
    id: P.legacy,
    org: O.northwind,
    name: 'Legacy CRM',
    color: '#4a3aa7',
    teams: [T.engineering],
    archived: true,
  },
  {
    id: P.scrapped,
    org: O.northwind,
    name: 'Scrapped pitch',
    color: '#e87ba4',
    teams: [],
    deleted: true,
  },
  { id: P.onboarding, org: O.harbor, name: 'Client onboarding', color: '#008300', teams: [] },
  { id: P.audit, org: O.harbor, name: 'Audit', color: '#e34948', teams: [T.delivery] },
]

// Northwind projects each user logs time on; Olivia and Adam also use Internal.
const workload: Record<string, string[]> = {
  [U.owner]: [P.internal],
  [U.admin]: [P.internal, P.website],
  [U.lead]: [P.website, P.internal],
  [U.member]: [P.website, P.mobile],
  [U.engLead]: [P.mobile, P.legacy],
  [U.engineer]: [P.mobile, P.internal],
  [U.loner]: [P.internal],
}

const tasks = ['Planning', 'Review', 'Implementation', 'Meeting', 'Research', 'Bug fixing', '']

// Deterministic pseudo-random numbers (mulberry32), so every seed looks the same.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

export interface SeedOptions {
  // Entries cover the three weeks before this moment; the running timer started 45
  // minutes before it.
  now?: Date
}

export async function seed(db: Database, { now = new Date() }: SeedOptions = {}) {
  const passwordHash = await hashPassword(SEED_PASSWORD)
  const at = now

  await withActor(SYSTEM_USER_ID, () =>
    db.transaction(async (tx) => {
      await tx.insert(user).values([
        {
          id: SYSTEM_USER_ID,
          name: 'System',
          email: 'system@snowtime.invalid',
          emailVerified: true,
          createdAt: at,
          updatedAt: at,
        },
        ...seedUsers.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          emailVerified: true,
          createdAt: at,
          updatedAt: at,
        })),
      ])
      // Better Auth's email + password accounts: provider "credential", account id = user id.
      await tx.insert(account).values(
        seedUsers.map((p) => ({
          id: uuidv7(),
          userId: p.id,
          accountId: p.id,
          providerId: 'credential',
          password: passwordHash,
          createdAt: at,
          updatedAt: at,
        })),
      )
      await tx
        .insert(userSettings)
        .values(seedUsers.map((p) => ({ userId: p.id, timeZone: p.timeZone })))

      await tx.insert(organization).values([
        { id: O.northwind, name: 'Northwind Studio', slug: 'northwind', createdAt: at },
        { id: O.harbor, name: 'Harbor Consulting', slug: 'harbor', createdAt: at },
      ])
      await tx.insert(member).values(
        memberships.map((m) => ({
          id: uuidv7(),
          organizationId: m.org,
          userId: m.user,
          role: m.role,
          createdAt: at,
        })),
      )
      await tx.insert(team).values(
        teams.map((t) => ({
          id: t.id,
          organizationId: t.org,
          name: t.name,
          memberCount: t.members.length + 1,
          createdAt: at,
          updatedAt: at,
        })),
      )
      await tx
        .insert(teamMember)
        .values(
          teams.flatMap((t) => [
            { id: uuidv7(), teamId: t.id, userId: t.lead, role: 'lead' as const, createdAt: at },
            ...t.members.map((userId) => ({ id: uuidv7(), teamId: t.id, userId, createdAt: at })),
          ]),
        )

      await tx.insert(project).values(
        projects.map((p) => ({
          id: p.id,
          organizationId: p.org,
          name: p.name,
          color: p.color,
          archivedAt: p.archived ? new Date(at.getTime() - 7 * DAY) : null,
          sysDeleted: p.deleted ?? false,
        })),
      )
      await tx
        .insert(projectTeam)
        .values(
          projects.flatMap((p) =>
            p.teams.map((teamId) => ({ projectId: p.id, teamId, organizationId: p.org })),
          ),
        )

      await tx.insert(timeEntry).values(entries(at))
    }),
  )
}

type NewEntry = typeof timeEntry.$inferInsert

function entries(now: Date): NewEntry[] {
  const rand = random(42)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const rows: NewEntry[] = []

  // Weekdays of the last three weeks, 08:00–17:00 UTC, in two to four blocks a day.
  for (let back = 21; back >= 1; back--) {
    const day = today - back * DAY
    const weekday = new Date(day).getUTCDay()
    if (weekday === 0 || weekday === 6) continue
    for (const [userId, userProjects] of Object.entries(workload)) {
      let start = day + 8 * HOUR + Math.floor(rand() * 4) * 15 * 60_000
      const end = day + 17 * HOUR
      while (start < end - HOUR) {
        const length = (1 + Math.floor(rand() * 12)) * 15 * 60_000 // 15 min to 3 h
        const stop = Math.min(start + length, end)
        rows.push({
          id: uuidv7(),
          organizationId: O.northwind,
          userId,
          projectId: userProjects[Math.floor(rand() * userProjects.length)],
          description: tasks[Math.floor(rand() * tasks.length)],
          startedAt: new Date(start),
          stoppedAt: new Date(stop),
        })
        start = stop + Math.floor(rand() * 3) * 15 * 60_000
      }
    }
  }

  const yesterday = today - DAY
  rows.push(
    {
      id: seedIds.entries.overnight,
      organizationId: O.northwind,
      userId: U.engLead,
      projectId: P.mobile,
      description: 'Release night',
      startedAt: new Date(yesterday + 22.5 * HOUR),
      stoppedAt: new Date(today + 1.25 * HOUR),
    },
    {
      id: seedIds.entries.deleted,
      organizationId: O.northwind,
      userId: U.engineer,
      projectId: P.internal,
      description: 'Logged by mistake',
      startedAt: new Date(yesterday + 18 * HOUR),
      stoppedAt: new Date(yesterday + 19 * HOUR),
      sysDeleted: true,
    },
    {
      id: seedIds.entries.harbor,
      organizationId: O.harbor,
      userId: U.member,
      projectId: P.audit,
      description: 'Audit prep',
      startedAt: new Date(yesterday + 17.5 * HOUR),
      stoppedAt: new Date(yesterday + 19.5 * HOUR),
    },
    {
      id: seedIds.entries.running,
      organizationId: O.northwind,
      userId: U.member,
      projectId: P.website,
      description: 'Landing page',
      startedAt: new Date(now.getTime() - 45 * 60_000),
      stoppedAt: null,
    },
  )
  return rows
}

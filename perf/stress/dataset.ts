// The load benchmark's datasets (task 078): S is the demo seed plus Lumen Works; M and L add
// companies with a long tail of sizes, whose people work as Lumen's do (workEntries in
// src/db/seed-company.ts). The data ends at the moment it's generated, because the release
// image runs on the real clock, and is otherwise the same on every run.
//
// Every user gets a session, so a run needn't sign thousands in first. Beside the database,
// <name>.users.json lists each current member with the IDs a replayed request needs.
//
//   bun perf/stress/dataset.ts S|M|L

import { hashPassword } from 'better-auth/crypto'
import { Database as Sqlite } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { SYSTEM_USER_ID } from '~/db/actor'
import { relations } from '~/db/relations'
import { SEED_PASSWORD, random, seed } from '~/db/seed'
import {
  companyIds,
  type Person,
  type ProjectSpec,
  seedCompany,
  teamWork,
  workEntries,
} from '~/db/seed-company'
import { CACHE, ROOT, inputsHash } from '../lib/database'

export const DATASETS = ['S', 'M', 'L'] as const
export type DatasetName = (typeof DATASETS)[number]

// Company sizes: a few large ones, some mid-sized, and many of 2 to 10 people. The largest
// is the membersPerOrganization limit.
const SIZES: Record<
  DatasetName,
  { large: number[]; medium: [number, number, number]; small: number }
> = {
  S: { large: [], medium: [0, 0, 0], small: 0 },
  // About 1,000 people in 60 companies.
  M: { large: [200, 100, 80, 60, 50], medium: [15, 15, 30], small: 40 },
  // About 6,000 people in 300 companies.
  L: {
    large: [500, 300, 200, 200, 150, 120, 100, 100, 80, 80, 60, 60, 50, 50, 50],
    medium: [60, 20, 45],
    small: 225,
  },
}

// The share of current members whose timer is running when the data ends.
const RUNNING_SHARE = 0.15

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const DAYS = 365

// One current member, as the load generator replays requests for them.
export interface BenchUser {
  userId: string
  email: string
  organizationId: string
  slug: string
  role: string
  // The account's language, which a returning browser has in Paraglide's cookie.
  locale: string
  // The session's token, which the load generator signs with the server's secret.
  token: string
  // A finished entry of theirs to edit, and projects they may log to.
  entryId: string
  projectIds: string[]
}

const TEAM_KINDS = Object.values(companyIds.teams)
const ZONES = [
  ...Array<string>(14).fill('Europe/Tallinn'),
  'Europe/Helsinki',
  'Europe/Stockholm',
  'Europe/Berlin',
  'Europe/Warsaw',
  'Europe/Madrid',
  'America/New_York',
]
const CLIENTS = [
  'Nordbank',
  'Kalev',
  'Harbor',
  'Ferry',
  'Clinic',
  'Museum',
  'Transit',
  'Energy',
  'Retail',
  'Permit',
  'Parking',
  'Fitness',
  'Webshop',
  'Library',
  'Airport',
  'Insurance',
]
const PRODUCTS = ['website', 'app', 'portal', 'dashboard', 'redesign', 'platform', 'support']
const COLORS = ['#3b82b8', '#d9703f', '#7a6fc8', '#4f8f3a', '#c9514f', '#e0a030', '#2e8b57']

// UUIDv7-shaped IDs from a counter, so every run makes the same ones. Entries put their start
// in the timestamp bits, as the app's would.
let counter = 0
function nextId(at = 0x0190_0000_0000): string {
  const time = Math.max(0, Math.floor(at)).toString(16).padStart(12, '0').slice(-12)
  const n = (counter++).toString(16).padStart(15, '0')
  return `${time.slice(0, 8)}-${time.slice(8)}-7${n.slice(0, 3)}-9${n.slice(3, 6)}-${n.slice(3)}`
}

function companySizes(name: DatasetName, rand: () => number): number[] {
  const { large, medium, small } = SIZES[name]
  const [count, min, max] = medium
  return [
    ...large,
    ...Array.from({ length: count }, () => Math.round(min + rand() * (max - min))),
    ...Array.from({ length: small }, () => 2 + Math.floor(rand() * 9)),
  ]
}

interface GeneratedCompany {
  id: string
  slug: string
  name: string
  people: (Person & { id: string })[]
  teams: { id: string; name: string; kind: string }[]
  projects: { spec: ProjectSpec; id: string }[]
}

function company(index: number, size: number, rand: () => number): GeneratedCompany {
  function pick<T>(list: T[]): T {
    return list[Math.floor(rand() * list.length)]
  }
  const id = nextId()
  const teams = Array.from({ length: Math.min(100, Math.max(1, Math.ceil(size / 7))) }, (_, i) => {
    const kind = TEAM_KINDS[i % TEAM_KINDS.length]
    return { id: nextId(), kind, name: `${['Design', 'Web', 'Mobile', 'Data'][i % 4]} ${i + 1}` }
  })
  const people = Array.from({ length: size }, (_, i): Person & { id: string } => {
    const person: Person & { id: string } = {
      id: nextId(),
      key: `c${index}p${i}`,
      name: `Person ${i + 1} of Company ${index + 1}`,
      timeZone: pick(ZONES),
    }
    if (i === 0) return { ...person, role: 'owner' }
    if (i <= Math.floor(size / 40)) person.role = 'admin'
    const home = teams[i % teams.length]
    // The first person in each team leads it.
    if (i <= teams.length) person.leads = [home.id]
    else person.teams = [home.id]
    if (rand() < 0.15 && teams.length > 1) (person.teams ??= []).push(pick(teams).id)
    if (person.teams)
      person.teams = [...new Set(person.teams)].filter((t) => t !== person.leads?.[0])
    if (rand() < 0.1)
      person.workdays = pick([
        [1, 2, 4],
        [1, 2, 3],
        [2, 3, 4, 5],
      ])
    if (rand() < 0.1) person.joins = 0.1 + rand() * 0.7
    else if (rand() < 0.05) person.leaves = 0.3 + rand() * 0.6
    if (rand() < 0.05) person.evenings = true
    return person
  })
  const internal: ProjectSpec[] = ['Internal', 'Sales and pitches', 'Hiring', 'Training'].map(
    (name, i) => ({ name, color: COLORS[i], teams: [], internal: true }),
  )
  const client = Array.from(
    { length: Math.min(150, Math.max(2, Math.round(size * 0.8))) },
    (_, i): ProjectSpec => {
      const owners = [pick(teams).id]
      if (rand() < 0.3) owners.push(pick(teams).id)
      const from = rand() < 0.3 ? rand() * 0.6 : undefined
      const to = rand() < 0.3 ? (from ?? 0) + 0.1 + rand() * 0.3 : undefined
      const customer = pick(CLIENTS)
      return {
        name: `${customer} ${pick(PRODUCTS)} ${i + 1}`,
        key: rand() < 0.7 ? `${customer.slice(0, 3).toUpperCase()}${i + 1}` : undefined,
        color: pick(COLORS),
        teams: [...new Set(owners)],
        from,
        to: to !== undefined && to < 1 ? to : undefined,
      }
    },
  )
  return {
    id,
    slug: `bench-${index + 1}`,
    name: `Company ${index + 1}`,
    people,
    teams,
    projects: [...internal, ...client].map((spec) => ({ spec, id: nextId() })),
  }
}

// Writes the generated companies straight into the migrated file: through Drizzle, 6 million
// entries take far longer than the minute this takes.
function insertCompanies(
  file: Sqlite,
  companies: GeneratedCompany[],
  passwordHash: string,
  { now, rand }: { now: number; rand: () => number },
) {
  const yearStart = now - DAYS * DAY
  // Whole milliseconds, as the app writes them; a fraction would make SQLite store a REAL.
  function at(share: number) {
    return Math.round(yearStart + share * DAYS * DAY)
  }
  const statements = {
    organization: file.prepare(
      'insert into organization (id, name, slug, created_at) values (?, ?, ?, ?)',
    ),
    user: file.prepare(
      'insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    ),
    account: file.prepare(
      `insert into account (id, user_id, account_id, provider_id, password, created_at, updated_at)
       values (?, ?, ?, 'credential', ?, ?, ?)`,
    ),
    settings: file.prepare(
      `insert into user_settings (user_id, time_zone, created_by, updated_by, scene_intro)
       values (?, ?, ?, ?, 0)`,
    ),
    member: file.prepare(
      'insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, ?)',
    ),
    team: file.prepare(
      `insert into team (id, organization_id, name, member_count, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?)`,
    ),
    teamMember: file.prepare(
      'insert into team_member (id, team_id, user_id, role, created_at) values (?, ?, ?, ?, ?)',
    ),
    project: file.prepare(
      `insert into project (id, organization_id, name, color, archived_at, created_at, created_by,
       updated_at, updated_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    projectTeam: file.prepare(
      `insert into project_team (project_id, team_id, organization_id, created_at, created_by)
       values (?, ?, ?, ?, ?)`,
    ),
    entry: file.prepare(
      `insert into time_entry (id, organization_id, user_id, project_id, description, started_at,
       stopped_at, created_at, created_by, updated_at, updated_by, sys_deleted, ticket)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
  }
  const S = SYSTEM_USER_ID
  let entries = 0
  for (const c of companies) {
    file.transaction(() => {
      const founded = yearStart - 30 * DAY
      statements.organization.run(c.id, c.name, c.slug, founded)
      for (const p of c.people) {
        const joined = at(p.joins ?? 0)
        statements.user.run(p.id, p.name, `${p.key}@bench.example.com`, joined, joined)
        statements.account.run(nextId(), p.id, p.id, passwordHash, joined, joined)
        statements.settings.run(p.id, p.timeZone, S, S)
        if (p.leaves === undefined) {
          statements.member.run(nextId(), c.id, p.id, p.role ?? 'member', joined)
        }
      }
      const current = c.people.filter((p) => p.leaves === undefined)
      for (const t of c.teams) {
        const rows = current.flatMap((p) => [
          ...(p.leads ?? []).filter((id) => id === t.id).map(() => ({ p, role: 'lead' })),
          ...(p.teams ?? []).filter((id) => id === t.id).map(() => ({ p, role: 'member' })),
        ])
        statements.team.run(t.id, c.id, t.name, rows.length, founded, founded)
        for (const r of rows)
          statements.teamMember.run(nextId(), t.id, r.p.id, r.role, at(r.p.joins ?? 0))
      }
      for (const { spec, id } of c.projects) {
        const created = at(spec.from ?? 0)
        const archived = spec.to === undefined ? null : at(spec.to)
        statements.project.run(
          id,
          c.id,
          spec.name,
          spec.color,
          archived,
          created,
          S,
          archived ?? created,
          S,
        )
        for (const teamId of spec.teams) statements.projectTeam.run(id, teamId, c.id, created, S)
      }

      const rows = workEntries(
        {
          organizationId: c.id,
          people: c.people,
          projects: c.projects,
          teamWork: Object.fromEntries(c.teams.map((t) => [t.id, teamWork[t.kind]])),
          releaseTeams: c.teams.filter((t) => t.kind === companyIds.teams.mobile).map((t) => t.id),
        },
        { rand, yearStart, end: now, days: DAYS, newId: nextId },
      )
      // Running timers, started after the person's last entry ends, on their first project.
      const running = new Map(
        current
          .filter(() => rand() < RUNNING_SHARE)
          .map((p) => [p.id, Math.round(now - (10 + rand() * 170) * MINUTE)]),
      )
      for (const r of rows) {
        const startedAt = r.startedAt.getTime()
        const stoppedAt = r.stoppedAt!.getTime()
        const timer = running.get(r.userId)
        if (timer !== undefined && stoppedAt > timer) continue
        statements.entry.run(
          r.id,
          c.id,
          r.userId,
          r.projectId ?? null,
          r.description ?? '',
          startedAt,
          stoppedAt,
          stoppedAt,
          r.userId,
          stoppedAt,
          r.userId,
          r.sysDeleted ? 1 : 0,
          r.ticket ?? null,
        )
        entries++
      }
      for (const [userId, startedAt] of running) {
        statements.entry.run(
          nextId(startedAt),
          c.id,
          userId,
          c.projects[0].id,
          'Team meeting',
          startedAt,
          null,
          startedAt,
          userId,
          startedAt,
          userId,
          0,
          null,
        )
        entries++
      }
    })()
  }
  return entries
}

// A session for every user, in the organization they belong to, and the list of current
// members for the load generator.
function sessions(file: Sqlite, now: number): BenchUser[] {
  const members = file
    .query<
      {
        userId: string
        email: string
        organizationId: string
        slug: string
        role: string
        locale: string
      },
      []
    >(
      `select m.user_id as userId, u.email, m.organization_id as organizationId, o.slug, m.role,
       coalesce(s.locale, 'en') as locale
       from member m join user u on u.id = m.user_id join organization o on o.id = m.organization_id
       left join user_settings s on s.user_id = m.user_id
       order by u.email, o.slug`,
    )
    .all()
  const latest = file.query<{ id: string } | null, [string, string]>(
    `select id from time_entry where organization_id = ? and user_id = ? and stopped_at is not null
     and sys_deleted = 0 order by started_at desc limit 1`,
  )
  // Projects the member's teams may log to, and those open to everyone.
  const open = file.query<{ id: string }, [string, string, string]>(
    `select p.id from project p where p.organization_id = ? and p.sys_deleted = 0
     and p.archived_at is null and (
       not exists (select 1 from project_team pt where pt.project_id = p.id)
       or exists (select 1 from project_team pt join team_member tm on tm.team_id = pt.team_id
                  where pt.project_id = p.id and tm.user_id = ? and pt.organization_id = ?))
     order by p.id limit 3`,
  )
  const insert = file.prepare(
    `insert into session (id, user_id, token, expires_at, active_organization_id, created_at,
     updated_at) values (?, ?, ?, ?, ?, ?, ?)`,
  )
  const users: BenchUser[] = []
  const seen = new Set<string>()
  file.transaction(() => {
    for (const m of members) {
      // A user in several organizations benchmarks the first.
      if (seen.has(m.userId)) continue
      seen.add(m.userId)
      const entry = latest.get(m.organizationId, m.userId)
      if (!entry) continue
      const token = createHash('sha256')
        .update(`bench-session:${m.userId}`)
        .digest('base64url')
        .slice(0, 32)
      insert.run(nextId(now), m.userId, token, now + 30 * DAY, m.organizationId, now, now)
      users.push({
        ...m,
        token,
        entryId: entry.id,
        projectIds: open.all(m.organizationId, m.userId, m.organizationId).map((p) => p.id),
      })
    }
  })()
  return users
}

function datasetPaths(name: DatasetName, day = new Date().toISOString().slice(0, 10)) {
  const base = join(CACHE, 'stress', `${name}-${day}-${inputsHash(['perf/stress/dataset.ts'])}`)
  return { database: `${base}.db`, users: `${base}.users.json` }
}

// Returns the dataset's files, generating them first when today has none. Older files of the
// same dataset are removed.
export async function dataset(name: DatasetName, day?: string) {
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Dataset date is YYYY-MM-DD')
  const folder = join(CACHE, 'stress')
  if (day && existsSync(folder)) {
    const preserved = readdirSync(folder).filter(
      (file) =>
        file.startsWith(`${name}-${day}-`) &&
        file.endsWith('.db') &&
        existsSync(join(folder, file.replace(/\.db$/, '.users.json'))),
    )
    if (preserved.length > 1) throw new Error(`Ambiguous preserved ${name} dataset for ${day}`)
    if (preserved.length === 1) {
      const database = join(folder, preserved[0])
      return { database, users: database.replace(/\.db$/, '.users.json') }
    }
  }
  const paths = datasetPaths(name, day)
  if (existsSync(paths.database) && existsSync(paths.users)) return paths
  if (day && day !== new Date().toISOString().slice(0, 10))
    throw new Error(`No preserved ${name} dataset for ${day}; generate a fresh matched pair`)
  mkdirSync(folder, { recursive: true })
  for (const old of readdirSync(folder)) {
    if (old.startsWith(`${name}-`)) rmSync(join(folder, old), { force: true })
  }
  const started = performance.now()
  console.log(`[stress] Generating dataset ${name} in ${relative(ROOT, paths.database)} ...`)
  const partial = `${paths.database}.partial`
  rmSync(partial, { force: true })
  const now = new Date()
  const db = drizzle({ connection: { url: `file:${partial}` }, relations })
  await migrate(db, { migrationsFolder: join(ROOT, 'drizzle') })
  await seed(db, { now })
  await seedCompany(db, { now })
  db.$client.close()

  counter = 0
  const rand = random(78)
  const file = new Sqlite(partial)
  file.run('pragma synchronous = off')
  const companies = companySizes(name, rand).map((size, i) => company(i, size, rand))
  const entries = insertCompanies(file, companies, await hashPassword(SEED_PASSWORD), {
    now: now.getTime(),
    rand,
  })
  const users = sessions(file, now.getTime())
  file.close()
  renameSync(partial, paths.database)
  writeFileSync(paths.users, JSON.stringify(users))
  const people = companies.reduce((total, c) => total + c.people.length, 0)
  console.log(
    `[stress] ${name}: ${companies.length} generated companies, ${people} people, ${entries} entries ` +
      `beside the seed; ${users.length} users with a session; ` +
      `${(statSync(paths.database).size / 1e6).toFixed(0)} MB in ` +
      `${Math.round((performance.now() - started) / 1000)} s`,
  )
  return paths
}

if (import.meta.main) {
  const name = process.argv[2] as DatasetName
  if (!DATASETS.includes(name))
    throw new Error(`[stress] Usage: bun perf/stress/dataset.ts ${DATASETS.join('|')}`)
  await dataset(name)
}

// A mid-sized company with a year of time entries, for checking queries and pages at a
// realistic size: `bun run db:seed --company`. It adds its own organization beside the
// small demo set in seed.ts, which tests use, and shares no users with it.
//
// About 20,000 entries from 18 current members and one former one, shaped like real use:
// weekends, public holidays, vacations and sick days off; part-time and late-joining
// members; projects that start and end during the year and are then archived; ticket
// descriptions that repeat within a week; evening, overnight and weekend work; a few
// entries without a project or deleted; and three running timers.
import { hashPassword } from 'better-auth/crypto'
import { v7 as uuidv7 } from 'uuid'
import { addDays, datesBetween, type IsoDate, localDate, startOfDay } from '~/lib/calendar'
import type { Database } from '.'
import { SYSTEM_USER_ID, withActor } from './actor'
import {
  account,
  invitation,
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
import { SEED_PASSWORD, random } from './seed'

function id(n: number) {
  return `01900000-0000-7000-8001-${n.toString(16).padStart(12, '0')}`
}

export const companyIds = {
  org: id(0x100),
  teams: { design: id(0x201), web: id(0x202), mobile: id(0x203), data: id(0x204) },
} as const

const O = companyIds.org
const T = companyIds.teams

type Settings = Partial<typeof userSettings.$inferInsert>

interface Person {
  key: string
  name: string
  timeZone: string
  role?: 'owner' | 'admin'
  teams?: string[]
  leads?: string[]
  // Weekdays worked (0 Sunday to 6 Saturday), when not Monday to Friday.
  workdays?: number[]
  // Share of the year, from its start, when the person joined or left.
  joins?: number
  leaves?: number
  // Works late: starts after ten, and some evenings.
  evenings?: boolean
  settings?: Settings
}

const people: Person[] = [
  { key: 'kristiina', name: 'Kristiina Kask', timeZone: 'Europe/Tallinn', role: 'owner' },
  {
    key: 'jonas',
    name: 'Jonas Berg',
    timeZone: 'Europe/Stockholm',
    role: 'admin',
    teams: [T.web],
  },
  {
    key: 'aino',
    name: 'Aino Laine',
    timeZone: 'Europe/Helsinki',
    role: 'admin',
    teams: [T.data],
    settings: { locale: 'et', theme: 'dark' },
  },
  { key: 'priit', name: 'Priit Tamm', timeZone: 'Europe/Tallinn', leads: [T.design] },
  { key: 'liis', name: 'Liis Saar', timeZone: 'Europe/Tallinn', teams: [T.design] },
  {
    key: 'marta',
    name: 'Marta Nowak',
    timeZone: 'Europe/Warsaw',
    teams: [T.design, T.web],
    workdays: [1, 2, 4],
  },
  {
    key: 'oskar',
    name: 'Oskar Lind',
    timeZone: 'Europe/Tallinn',
    teams: [T.design],
    joins: 0.45,
  },
  {
    key: 'sofia',
    name: 'Sofia Rossi',
    timeZone: 'Europe/Rome',
    leads: [T.web],
    settings: { timerLayout: 'table', compactRows: true },
  },
  { key: 'erik', name: 'Erik Mets', timeZone: 'Europe/Tallinn', teams: [T.web] },
  { key: 'hanna', name: 'Hanna Vogel', timeZone: 'Europe/Berlin', teams: [T.web] },
  { key: 'rasmus', name: 'Rasmus Ilves', timeZone: 'Europe/Tallinn', teams: [T.web, T.mobile] },
  {
    key: 'daniel',
    name: 'Daniel Park',
    timeZone: 'America/New_York',
    leads: [T.mobile],
    evenings: true,
    settings: { weekStart: 'sun', dateFormat: 'mdy', timeFormat: '12h' },
  },
  { key: 'karl', name: 'Karl Kuusk', timeZone: 'Europe/Tallinn', teams: [T.mobile] },
  {
    key: 'lucia',
    name: 'Lucía Fernández',
    timeZone: 'Europe/Madrid',
    teams: [T.mobile],
    settings: { durationFormat: 'units' },
  },
  { key: 'elena', name: 'Elena Petrova', timeZone: 'Europe/Tallinn', leads: [T.data] },
  { key: 'mihkel', name: 'Mihkel Rebane', timeZone: 'Europe/Tallinn', teams: [T.data] },
  {
    key: 'grete',
    name: 'Grete Org',
    timeZone: 'Europe/Tallinn',
    teams: [T.data],
    workdays: [1, 2, 3],
    joins: 0.7,
  },
  { key: 'tanel', name: 'Tanel Uus', timeZone: 'Europe/Tallinn', teams: [T.data, T.web] },
  // Left mid-year: entries remain, membership and teams are gone.
  { key: 'jaan', name: 'Jaan Sepp', timeZone: 'Europe/Tallinn', teams: [T.mobile], leaves: 0.5 },
]

function email(p: Person) {
  return `${p.key}@lumen.example.com`
}

const userIds = new Map(people.map((p, i) => [p.key, id(0x1000 + i)]))

function userId(key: string) {
  return userIds.get(key)!
}

// The company's users the sign-in screen lists in local development, beside seedUsers.
export const companyUsers = ['kristiina', 'jonas', 'sofia', 'daniel', 'marta'].map((key) => {
  const p = people.find((q) => q.key === key)!
  return { name: p.name, email: email(p) }
})

const teams = [
  { id: T.design, name: 'Design' },
  { id: T.web, name: 'Web' },
  { id: T.mobile, name: 'Mobile' },
  { id: T.data, name: 'Data' },
]

interface ProjectSpec {
  name: string
  color: string
  teams: string[]
  // Share of the year when work starts and ends; a project that ends is archived then.
  from?: number
  to?: number
  internal?: boolean
  deleted?: boolean
  // The client's issue tracker prefix, as in NBW-412.
  key?: string
}

const projectSpecs: ProjectSpec[] = [
  { name: 'Internal', color: '#1f9e8a', teams: [], internal: true },
  { name: 'Sales and pitches', color: '#c9759f', teams: [], internal: true },
  { name: 'Hiring', color: '#8a8f3a', teams: [], internal: true },
  { name: 'Training', color: '#5a4fa8', teams: [], internal: true },
  { name: 'Nordbank brand refresh', key: 'NBR', color: '#3b82b8', teams: [T.design], to: 0.35 },
  { name: 'Nordbank website', key: 'NBW', color: '#2f6f9f', teams: [T.design, T.web], from: 0.2 },
  {
    name: 'Kalev Foods packaging',
    key: 'KAL',
    color: '#d9703f',
    teams: [T.design],
    from: 0.4,
    to: 0.75,
  },
  { name: 'Museum wayfinding', key: 'MUS', color: '#b0613a', teams: [T.design], from: 0.7 },
  { name: 'Design system', key: 'DS', color: '#7a6fc8', teams: [T.design, T.web] },
  { name: 'Ferry booking', key: 'FERRY', color: '#4f8f3a', teams: [T.web], to: 0.6 },
  {
    name: 'Ferry booking support',
    key: 'FERRY',
    color: '#6aa84f',
    teams: [T.web, T.mobile],
    from: 0.6,
  },
  { name: 'City permits portal', key: 'PERMIT', color: '#c9514f', teams: [T.web], from: 0.15 },
  { name: 'Clinic scheduling', key: 'CLIN', color: '#e0a030', teams: [T.web, T.data], from: 0.55 },
  { name: 'Webshop migration', key: 'SHOP', color: '#8b5a2b', teams: [T.web], to: 0.25 },
  { name: 'Parking app', key: 'PARK', color: '#d94f7a', teams: [T.mobile] },
  { name: 'Fitness tracker', key: 'FIT', color: '#3f9fbf', teams: [T.mobile], from: 0.3, to: 0.85 },
  { name: 'Transit card app', key: 'TRANSIT', color: '#9f3fbf', teams: [T.mobile], from: 0.8 },
  { name: 'Energy dashboard', key: 'ENRG', color: '#2e8b57', teams: [T.data], to: 0.5 },
  { name: 'Retail forecasting', key: 'RF', color: '#b8860b', teams: [T.data], from: 0.35 },
  { name: 'Data platform', key: 'DP', color: '#4682b4', teams: [T.data, T.web] },
  { name: 'Analytics audits', key: 'AUD', color: '#708090', teams: [T.data], from: 0.1, to: 0.3 },
  { name: 'Hackathon', color: '#ff7f50', teams: [], from: 0.62, to: 0.64 },
  { name: 'Grant application', color: '#6b8e23', teams: [], from: 0.05, to: 0.12 },
  { name: 'Duplicate of Parking app', color: '#999999', teams: [T.mobile], deleted: true },
]

const projectIds = projectSpecs.map((_, i) => id(0x3000 + i))

// Work per team. Client work mostly starts with a ticket key; the ticket repeats through its
// week.
const teamWork: Record<string, string[]> = {
  [T.design]: [
    'Wireframes for the onboarding flow, second round after the client workshop',
    'Visual design for the account overview, dark mode variants',
    'Design review with the client: navigation, typography and colour contrast',
    'Clickable prototype for the usability test on Thursday',
    'User interviews: notes and affinity map',
    'Icon set: 24 px grid, outline and filled states',
    'Handoff to developers, annotate spacing and breakpoints',
    'Style guide update for buttons, form fields and error states',
    'Moodboard and first concepts',
    'Design review',
  ],
  [T.web]: [
    'Checkout: validate Finnish and Swedish postcodes before the payment step',
    'API integration for the booking calendar, handle 409 conflicts',
    'Code review',
    'Fix the date picker losing focus in Safari when the month changes',
    'Accessibility fixes from the audit: focus order, labels and landmarks',
    'Performance: cut the product list query from 1.2 s to under 200 ms',
    'Deploy to staging and smoke test the release candidate',
    'Unit and end-to-end tests for the permit application form',
    'Migrate the UTF-8 CSV import to the new upload service',
    'Refactor the session handling and remove the legacy cookie',
    'Bug fixing',
  ],
  [T.mobile]: [
    'iOS build: update to the new SDK and fix the deprecation warnings',
    'Android build: crash on devices with the system font scaled to 200%',
    'Code review',
    'Crash fixes from the store reports, top three by volume',
    'Push notifications for expiring parking sessions',
    'Store release: screenshots, release notes and phased rollout',
    'Offline mode: queue payments and retry when the connection returns',
    'QA pass on the release branch with the test devices',
    'Pair with the designers on the new onboarding screens',
  ],
  [T.data]: [
    'Pipeline: nightly load of the sales data, handle late-arriving rows',
    'Data modelling for the store hierarchy and regions',
    'Dashboard for weekly energy use per building',
    'Model training: retrain the forecast with the holiday calendar',
    'Data cleaning: duplicate customers and ISO-8601 timestamps with no zone',
    'Query tuning on the warehouse, partitions and clustering keys',
    'Code review',
    'Monthly report for the client with the forecast accuracy',
  ],
}

const internalWork: Record<string, string[]> = {
  Internal: [
    'Team meeting',
    'All hands: company update and Q&A',
    'Email and Slack',
    'Planning for next week',
    'Retro',
    '1:1',
    'Q3-2026 roadmap review with the leads',
    '',
  ],
  'Sales and pitches': [
    'Pitch deck for the transit authority tender',
    'Client call: scope and timeline for phase two',
    'Proposal and estimate for the clinic chain',
    'Estimate',
  ],
  Hiring: ['Interview: senior frontend developer', 'CV screening', 'Test task review'],
  Training: [
    'Conference talk rehearsal',
    'Online course: accessibility testing',
    'Reading',
    'Workshop',
  ],
  Hackathon: ['Hackathon: offline-first prototype', 'Hackathon'],
  'Grant application': ['Grant budget and work plan', 'Grant application text'],
}

// Estonian public holidays, as month and day.
const holidays = new Set(['01-01', '02-24', '05-01', '06-23', '06-24', '08-20', '12-24', '12-25'])

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export interface CompanySeedOptions {
  // The year of entries ends at this moment, where three timers are running.
  now?: Date
  days?: number
}

export async function seedCompany(
  db: Database,
  { now = new Date(), days = 365 }: CompanySeedOptions = {},
) {
  const passwordHash = await hashPassword(SEED_PASSWORD)
  const yearStart = now.getTime() - days * DAY
  function at(share: number) {
    return new Date(yearStart + share * days * DAY)
  }

  await withActor(SYSTEM_USER_ID, () =>
    db.transaction(async (tx) => {
      await tx.insert(organization).values({
        id: O,
        name: 'Lumen Works',
        slug: 'lumen',
        createdAt: new Date(yearStart - 30 * DAY),
      })

      await tx.insert(user).values(
        people.map((p) => ({
          id: userId(p.key),
          name: p.name,
          email: email(p),
          emailVerified: true,
          createdAt: at(p.joins ?? 0),
          updatedAt: at(p.joins ?? 0),
        })),
      )
      await tx.insert(account).values(
        people.map((p) => ({
          id: uuidv7(),
          userId: userId(p.key),
          accountId: userId(p.key),
          providerId: 'credential',
          password: passwordHash,
          createdAt: at(p.joins ?? 0),
          updatedAt: at(p.joins ?? 0),
        })),
      )
      await tx
        .insert(userSettings)
        .values(people.map((p) => ({ userId: userId(p.key), timeZone: p.timeZone, ...p.settings })))

      const current = people.filter((p) => p.leaves === undefined)
      await tx.insert(member).values(
        current.map((p) => ({
          id: uuidv7(),
          organizationId: O,
          userId: userId(p.key),
          role: p.role ?? 'member',
          createdAt: at(p.joins ?? 0),
        })),
      )
      const teamRows = current.flatMap((p) => [
        ...(p.leads ?? []).map((teamId) => ({ teamId, p, role: 'lead' as const })),
        ...(p.teams ?? []).map((teamId) => ({ teamId, p, role: 'member' as const })),
      ])
      await tx.insert(team).values(
        teams.map((t) => ({
          id: t.id,
          organizationId: O,
          name: t.name,
          memberCount: teamRows.filter((r) => r.teamId === t.id).length,
          createdAt: new Date(yearStart - 30 * DAY),
          updatedAt: new Date(yearStart - 30 * DAY),
        })),
      )
      await tx.insert(teamMember).values(
        teamRows.map((r) => ({
          id: uuidv7(),
          teamId: r.teamId,
          userId: userId(r.p.key),
          role: r.role,
          createdAt: at(r.p.joins ?? 0),
        })),
      )

      await tx.insert(project).values(
        projectSpecs.map((p, i) => ({
          id: projectIds[i],
          organizationId: O,
          name: p.name,
          color: p.color,
          archivedAt: p.to === undefined ? null : at(p.to),
          sysDeleted: p.deleted ?? false,
          createdAt: at(p.from ?? 0),
          updatedAt: at(p.to ?? p.from ?? 0),
        })),
      )
      await tx.insert(projectTeam).values(
        projectSpecs.flatMap((p, i) =>
          p.deleted
            ? []
            : p.teams.map((teamId) => ({
                projectId: projectIds[i],
                teamId,
                organizationId: O,
                createdAt: at(p.from ?? 0),
              })),
        ),
      )

      const owner = userId('kristiina')
      await tx.insert(invitation).values([
        {
          id: uuidv7(),
          organizationId: O,
          email: 'new.designer@example.com',
          role: 'member',
          teamId: T.design,
          status: 'pending',
          expiresAt: new Date(now.getTime() + 5 * DAY),
          inviterId: owner,
          createdAt: new Date(now.getTime() - 2 * DAY),
        },
        {
          id: uuidv7(),
          organizationId: O,
          email: 'contractor@example.com',
          role: 'member',
          status: 'pending',
          expiresAt: new Date(now.getTime() - 3 * DAY),
          inviterId: userId('jonas'),
          createdAt: new Date(now.getTime() - 10 * DAY),
        },
      ])

      const rows = entries(now, yearStart, days)
      // SQLite caps the variables in one statement; a time entry has 12 columns.
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(timeEntry).values(rows.slice(i, i + 500))
      }
    }),
  )
}

type NewEntry = typeof timeEntry.$inferInsert

function entries(now: Date, yearStart: number, days: number): NewEntry[] {
  const rand = random(7)
  function pick<T>(list: T[]): T {
    return list[Math.floor(rand() * list.length)]
  }
  function between(min: number, max: number) {
    return min + rand() * (max - min)
  }
  // Timer entries end on odd seconds; entries added by hand are on five minutes.
  function round(ms: number) {
    return rand() < 0.6 ? Math.round(ms / 1000) * 1000 : Math.round(ms / (5 * MINUTE)) * 5 * MINUTE
  }

  const end = now.getTime()
  const rows: NewEntry[] = []

  for (const p of people) {
    const uid = userId(p.key)
    const from = yearStart + (p.joins ?? 0) * days * DAY
    const until = p.leaves === undefined ? end : yearStart + p.leaves * days * DAY
    const dates = datesBetween(localDate(from, p.timeZone), localDate(until, p.timeZone))
    const off = daysOff(dates, rand)
    const personTeams = [...(p.leads ?? []), ...(p.teams ?? [])]
    const work = personTeams.map((t) => teamWork[t])

    // Projects the person can log to on the date: open to everyone or to one of their
    // teams, and running then.
    function open(date: IsoDate) {
      const ms = startOfDay(date, p.timeZone)
      return projectSpecs.flatMap((s, i) => {
        if (s.deleted) return []
        if (s.teams.length > 0 && !s.teams.some((t) => personTeams.includes(t))) return []
        if (ms < yearStart + (s.from ?? 0) * days * DAY) return []
        // A day's work, evenings included, ends before the project is archived.
        if (s.to !== undefined && ms + 2 * DAY > yearStart + s.to * days * DAY) return []
        return [{ spec: s, id: projectIds[i] }]
      })
    }

    let focus: { spec: ProjectSpec; id: string } | undefined
    let week = -1

    // Keys as people type them: mostly at the start, sometimes in brackets or after a
    // colon, sometimes mid-sentence, now and then two.
    function describe(spec: ProjectSpec, weekNumber: number) {
      if (internalWork[spec.name]) return pick(internalWork[spec.name])
      if (work.length === 0 || rand() < 0.08) return ''
      const text = pick(pick(work))
      if (!spec.key || rand() < 0.3) return text
      function ticket() {
        return `${spec.key}-${100 + weekNumber * 4 + Math.floor(rand() * 4)}`
      }
      const r = rand()
      if (r < 0.6) return `${ticket()} ${text}`
      if (r < 0.7) return `[${ticket()}] ${text}`
      if (r < 0.8) return `${ticket()}: ${text}`
      if (r < 0.92) return `${text} (${ticket()})`
      const first = ticket()
      const second = ticket()
      return first === second ? `${first} ${text}` : `${first} ${second} ${text}`
    }

    function add(projectId: string | null, description: string, start: number, stop: number) {
      if (start < from || start >= until) return
      stop = Math.min(stop, until)
      if (stop - start < MINUTE) return
      rows.push({
        id: uuidv7(),
        organizationId: O,
        userId: uid,
        projectId,
        description,
        startedAt: new Date(start),
        stoppedAt: new Date(stop),
        sysDeleted: rand() < 0.01,
      })
    }

    for (const date of dates) {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
      const weekend = weekday === 0 || weekday === 6
      const workday = p.workdays ? p.workdays.includes(weekday) : !weekend
      const dayStart = startOfDay(date, p.timeZone)
      const weekNumber = Math.floor((dayStart - yearStart) / (7 * DAY))
      const projects = open(date)
      // The year's first day starts before any project does.
      if (projects.length === 0) continue
      const client = projects.filter((q) => !q.spec.internal)
      const internal = projects.filter((q) => q.spec.internal)
      const sales = internal.find((q) => q.spec.name === 'Sales and pitches')!

      if (weekNumber !== week || !projects.some((q) => q.id === focus?.id)) {
        week = weekNumber
        focus = client.length > 0 ? pick(client) : pick(internal)
      }
      const main = focus!

      function project() {
        const r = rand()
        if (p.role === 'owner') return r < 0.5 ? sales : pick(internal)
        if (r < 0.04) return null
        if (r < 0.62 || client.length === 0) return main
        if (r < 0.85) return pick(client)
        return pick(internal)
      }

      if (weekend || !workday || off.has(date)) {
        // Now and then, a few hours of weekend work.
        if (weekend && personTeams.length > 0 && rand() < 0.04) {
          const start = round(dayStart + between(10, 15) * HOUR)
          add(main.id, describe(main.spec, weekNumber), start, round(start + between(1, 3) * HOUR))
        }
        continue
      }

      let t = round(dayStart + (p.evenings ? between(10, 11) : between(7.75, 9.75)) * HOUR)
      const target = t + (p.workdays ? between(5, 6.5) : between(6.5, 8.5)) * HOUR
      const lunch = t + between(3.5, 4.5) * HOUR
      let lunched = false

      if (personTeams.length > 0 && rand() < 0.6) {
        add(main.id, 'Standup', t, t + 15 * MINUTE)
        t += 15 * MINUTE + round(between(0, 5) * MINUTE)
      }
      while (t < target) {
        const r = rand()
        const length =
          r < 0.08
            ? between(2, 20) * MINUTE
            : r < 0.8
              ? between(0.5, 2) * HOUR
              : between(2, 3.5) * HOUR
        const stop = round(Math.min(t + length, target + 20 * MINUTE))
        const q = project()
        add(q?.id ?? null, q ? describe(q.spec, weekNumber) : pick(['', 'Email', 'Admin']), t, stop)
        t = stop + round(between(0, 10) * MINUTE)
        if (!lunched && t > lunch) {
          t += round(between(30, 60) * MINUTE)
          lunched = true
        }
      }

      // Late work starts an hour or more after the day's last entry.
      function late(description: string, from: number, hours: number) {
        const start = round(Math.max(t + HOUR, dayStart + from * HOUR))
        const stop = round(start + hours * HOUR)
        add(main.id, description, start, stop)
        t = stop
      }
      // Some evenings run past midnight.
      if (p.evenings && rand() < 0.3) {
        late(describe(main.spec, weekNumber), between(20, 22), between(1, 3.5))
      }
      if (personTeams.includes(T.mobile) && rand() < 0.015) {
        late('Store release', between(21, 22), between(2.5, 4.5))
      }
    }
  }

  // Running timers, started after the person's last entry ends.
  const running = [
    { userId: userId('erik'), startedAt: end - 25 * MINUTE },
    { userId: userId('daniel'), startedAt: end - 70 * MINUTE },
    { userId: userId('liis'), startedAt: end - 115 * MINUTE },
  ]
  const kept = rows.filter(
    (r) => !running.some((t) => t.userId === r.userId && r.stoppedAt!.getTime() > t.startedAt),
  )
  return kept.concat(
    running.map((t) => ({
      id: uuidv7(),
      organizationId: O,
      userId: t.userId,
      projectId: projectIds[0],
      description: 'Team meeting',
      startedAt: new Date(t.startedAt),
      stoppedAt: null,
    })),
  )
}

// Public holidays, a summer vacation of two to three weeks, two shorter breaks, and sick
// days.
function daysOff(dates: IsoDate[], rand: () => number): Set<IsoDate> {
  const off = new Set(dates.filter((d) => holidays.has(d.slice(5))))
  function block(start: IsoDate | undefined, length: number) {
    if (!start) return
    for (let i = 0; i < length; i++) off.add(addDays(start, i))
  }
  const summer = dates.filter((d) => ['06', '07', '08'].includes(d.slice(5, 7)))
  block(summer[Math.floor(rand() * summer.length)], 14 + Math.floor(rand() * 8))
  block(dates[Math.floor(rand() * dates.length)], 3 + Math.floor(rand() * 5))
  block(dates[Math.floor(rand() * dates.length)], 3 + Math.floor(rand() * 5))
  for (const d of dates) if (rand() < 0.02) block(d, 1 + Math.floor(rand() * 3))
  return off
}

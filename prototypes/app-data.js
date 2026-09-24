// Fictional Snowhound organization shared by the signed-in prototypes: members, teams, projects,
// and generated time entries, plus time zone helpers. Every call returns fresh copies, so pages can
// change their local state freely. Names match auth.html and timer.html.
;(() => {
  const MIN = 60_000
  const HOUR = 3_600_000

  // Project colors: the categorical slots validated in docs (see prototypes/README.md). The app
  // stores the light hex in project.color; prototype.css maps each slot to its dark step.
  const PALETTE = [
    { id: 'blue', light: '#2a78d6', dark: '#3987e5' },
    { id: 'orange', light: '#eb6834', dark: '#d95926' },
    { id: 'aqua', light: '#1baf7a', dark: '#199e70' },
    { id: 'yellow', light: '#eda100', dark: '#c98500' },
    { id: 'magenta', light: '#e87ba4', dark: '#d55181' },
    { id: 'green', light: '#008300', dark: '#008300' },
    { id: 'violet', light: '#4a3aa7', dark: '#9085e9' },
    { id: 'red', light: '#e34948', dark: '#e66767' },
  ]
  const colorVar = (hex) => {
    const i = PALETTE.findIndex((c) => c.light === hex)
    return i < 0 ? hex : `var(--series-${i + 1})`
  }

  const MEMBERS = [
    { id: 'u-mari', name: 'Mari Tamm', email: 'mari@snowhound.eu', role: 'owner', joined: '2025-03-02' },
    { id: 'u-anna', name: 'Anna Kask', email: 'anna@snowhound.eu', role: 'member', joined: '2026-09-01' },
    { id: 'u-jaan', name: 'Jaan Mets', email: 'jaan@snowhound.eu', role: 'admin', joined: '2025-03-04' },
    { id: 'u-liis', name: 'Liis Saar', email: 'liis@snowhound.eu', role: 'member', joined: '2025-05-19' },
    { id: 'u-karl', name: 'Karl Rebane', email: 'karl@snowhound.eu', role: 'member', joined: '2025-08-11' },
    { id: 'u-kadri', name: 'Kadri Lepp', email: 'kadri@snowhound.eu', role: 'member', joined: '2025-10-01' },
    { id: 'u-toomas', name: 'Toomas Kivi', email: 'toomas@snowhound.eu', role: 'member', joined: '2026-01-12' },
    { id: 'u-eva', name: 'Eva Põld', email: 'eva@snowhound.eu', role: 'member', joined: '2026-02-02' },
    { id: 'u-mihkel', name: 'Mihkel Oja', email: 'mihkel@snowhound.eu', role: 'member', joined: '2026-06-15' },
  ]

  // team_member rows: user and team role (lead or member).
  const TEAMS = [
    { id: 't-platform', name: 'Platform', members: [['u-jaan', 'lead'], ['u-anna', 'member'], ['u-liis', 'member'], ['u-karl', 'member']] },
    { id: 't-design', name: 'Design', members: [['u-eva', 'lead'], ['u-anna', 'member'], ['u-kadri', 'member']] },
    { id: 't-client', name: 'Client services', members: [['u-mari', 'lead'], ['u-toomas', 'member'], ['u-kadri', 'member']] },
  ]

  // Same ids and names as timer.html. `teams` is project_team; empty means the whole organization.
  const PROJECTS = [
    { id: 'p1', name: 'Snowtime', color: '#2a78d6', teams: ['t-platform'], archivedAt: null },
    { id: 'p2', name: 'Client portal', color: '#1baf7a', teams: ['t-client', 't-design'], archivedAt: null },
    { id: 'p3', name: 'Internal', color: '#eda100', teams: [], archivedAt: null },
    { id: 'p4', name: 'Nordic Logistics – warehouse management system migration', color: '#e34948', teams: ['t-client', 't-platform'], archivedAt: null },
    { id: 'p5', name: 'Design system', color: '#4a3aa7', teams: ['t-design'], archivedAt: null },
    { id: 'p6', name: 'Website 2025', color: '#e87ba4', teams: [], archivedAt: Date.parse('2026-06-30T12:00:00Z') },
  ]

  const LONG_PROJECTS = [
    { id: 'p7', name: 'Põhjamaade Logistika – tarneahela nähtavuse platvormi arendus ja integratsioonid', color: '#eb6834', teams: ['t-platform', 't-client', 't-design'], archivedAt: null },
    { id: 'p8', name: 'Accessibility audit for the public customer self-service portal (WCAG 2.2 AA)', color: '#008300', teams: ['t-design'], archivedAt: null },
    { id: 'p9', name: 'Data warehouse', color: '#2a78d6', teams: [], archivedAt: null },
    { id: 'p10', name: 'Security review', color: '#e87ba4', teams: ['t-platform'], archivedAt: null },
    { id: 'p11', name: 'Mobile app spike', color: '#1baf7a', teams: ['t-platform'], archivedAt: null },
    { id: 'p12', name: 'Hiring', color: '#eda100', teams: [], archivedAt: null },
  ]
  const LONG_MEMBERS = [
    { id: 'u-annabel', name: 'Annabel-Katariina von Löwenstein-Wertheim-Rosenberg', email: 'annabel-katariina.von.loewenstein-wertheim-rosenberg@snowhound.eu', role: 'member', joined: '2026-04-01' },
    { id: 'u-ants', name: 'Ants Õunapuu-Väljaots', email: 'ants.ounapuu-valjaots@snowhound.eu', role: 'admin', joined: '2026-05-01' },
  ]

  // --- Time zones ----------------------------------------------------------------------------
  // Wall-clock parts of an instant in a zone, and the instant of a wall-clock time in a zone.
  const partsFmt = new Map()
  function zonedParts(t, tz) {
    if (!partsFmt.has(tz))
      partsFmt.set(
        tz,
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' })
      )
    const p = Object.fromEntries(partsFmt.get(tz).formatToParts(t).map((x) => [x.type, x.value]))
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) }
  }
  const offsetAt = (t, tz) => {
    const p = zonedParts(t, tz)
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(t / 1000) * 1000
  }
  // Month and day may overflow (d + 1), like Date.UTC.
  function zonedTime(y, m, d, h = 0, min = 0, tz) {
    const guess = Date.UTC(y, m - 1, d, h, min)
    let t = guess - offsetAt(guess, tz)
    const again = guess - offsetAt(t, tz)
    if (again !== t) t = again
    return t
  }
  const startOfDay = (t, tz) => {
    const p = zonedParts(t, tz)
    return zonedTime(p.y, p.m, p.d, 0, 0, tz)
  }
  const addDays = (dayStart, n, tz) => {
    const p = zonedParts(dayStart + 12 * HOUR, tz)
    return zonedTime(p.y, p.m, p.d + n, 0, 0, tz)
  }
  const startOfWeek = (t, tz, weekStart) => {
    const day = startOfDay(t, tz)
    const wd = zonedParts(day + 12 * HOUR, tz).weekday
    return addDays(day, -(weekStart === 'sun' ? wd : (wd + 6) % 7), tz)
  }

  // --- Entries -------------------------------------------------------------------------------
  // Deterministic pseudo-random entries for the last ten weeks, in Tallinn wall time.
  function rng(seed) {
    let s = seed >>> 0
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  }
  const DESCRIPTIONS = {
    p1: ['Timer schema and partial unique index', 'Report time zone boundaries', 'Review: entry server functions', 'Prototype timer layouts'],
    p2: ['Invoice export review', 'Client portal bug triage', 'Sprint demo with the client'],
    p3: ['Standup and planning', 'Retro', 'Onboarding session', ''],
    p4: ['Stock adjustment import', 'Warehouse workshop', 'Migration dry run'],
    p5: ['Button and input tokens', 'Figma library cleanup'],
    p7: ['Carrier API integration', 'Tarneahela töötuba'],
    p8: ['Screen reader pass', 'Contrast fixes'],
    p9: ['ETL job'],
    p10: ['Threat model'],
    p11: ['Offline spike'],
    p12: ['Interviews'],
  }

  function projectsFor(userId, teams, projects) {
    const mine = teams.filter((t) => t.members.some(([u]) => u === userId)).map((t) => t.id)
    return projects.filter((p) => !p.archivedAt && (!p.teams.length || p.teams.some((t) => mine.includes(t))))
  }

  function generateEntries({ members, teams, projects, now = Date.now(), weeks = 10 }) {
    const tz = 'Europe/Tallinn'
    const entries = []
    let id = 1
    const today = startOfDay(now, tz)
    members.forEach((m, mi) => {
      const rand = rng(97 + mi * 7919)
      const available = projectsFor(m.id, teams, projects)
      if (!available.length) return
      for (let back = weeks * 7; back >= 0; back--) {
        const day = addDays(today, -back, tz)
        const p = zonedParts(day + 12 * HOUR, tz)
        const weekend = p.weekday === 0 || p.weekday === 6
        if (weekend ? rand() > 0.06 : rand() < 0.08) continue
        let minute = 8 * 60 + Math.floor(rand() * 90)
        const count = weekend ? 1 : 3 + Math.floor(rand() * 3)
        for (let i = 0; i < count; i++) {
          const project = available[Math.floor(rand() * available.length)]
          const length = 25 + Math.floor(rand() * 150)
          const startedAt = zonedTime(p.y, p.m, p.d, 0, minute, tz)
          const stoppedAt = startedAt + length * MIN
          if (stoppedAt > now) break
          const options = DESCRIPTIONS[project.id] ?? ['']
          entries.push({ id: `e${id++}`, userId: m.id, projectId: project.id, description: options[Math.floor(rand() * options.length)], startedAt, stoppedAt })
          minute += length + 5 + Math.floor(rand() * 40)
        }
      }
    })
    // Late work that crosses midnight, so reports show the split.
    const late = (userId, daysBack, h, min, minutes, projectId, description) => {
      const day = addDays(today, -daysBack, tz)
      const p = zonedParts(day + 12 * HOUR, tz)
      const startedAt = zonedTime(p.y, p.m, p.d, h, min, tz)
      if (members.some((m) => m.id === userId) && projects.some((x) => x.id === projectId))
        entries.push({ id: `e${id++}`, userId, projectId, description, startedAt, stoppedAt: startedAt + minutes * MIN })
    }
    late('u-karl', 2, 22, 30, 170, 'p4', 'Production cutover')
    late('u-toomas', 8, 23, 0, 105, 'p2', 'Hotfix release')
    late('u-anna', 1, 23, 15, 80, 'p1', 'Fix report rounding')
    late('u-jaan', 16, 21, 45, 200, 'p4', 'Migration night shift')
    // Anna's running timer, counted up to now.
    if (members.some((m) => m.id === 'u-anna'))
      entries.push({ id: `e${id++}`, userId: 'u-anna', projectId: 'p1', description: 'Prototype timer layouts', startedAt: now - 25 * MIN - 12_000, stoppedAt: null })
    return entries
  }

  const clone = (x) => JSON.parse(JSON.stringify(x))

  // role: the prototype role of Anna (member, lead, admin, owner).
  function organization({ role = 'admin', long = false } = {}) {
    const members = clone(long ? [...MEMBERS, ...LONG_MEMBERS] : MEMBERS)
    const teams = clone(TEAMS)
    const projects = clone(long ? [...PROJECTS, ...LONG_PROJECTS] : PROJECTS)
    members.find((m) => m.id === 'u-anna').role = role === 'lead' ? 'member' : role
    if (role === 'lead') teams.find((t) => t.id === 't-platform').members.find(([u]) => u === 'u-anna')[1] = 'lead'
    if (long) {
      teams.push({ id: 't-long', name: 'Warehouse management system migration – integration and data quality', members: [['u-annabel', 'lead'], ['u-ants', 'member'], ['u-karl', 'member'], ['u-toomas', 'member']] })
      teams.find((t) => t.id === 't-platform').members.push(['u-annabel', 'member'])
    }
    return { members, teams, projects }
  }

  window.appData = {
    PALETTE,
    colorVar,
    organization,
    generateEntries,
    projectsFor,
    currentUserId: 'u-anna',
    tz: { zonedParts, zonedTime, startOfDay, addDays, startOfWeek },
    MIN,
    HOUR,
  }
})()

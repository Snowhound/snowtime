// The calls registered by server/src/*/routes.rs, by method and path as the API serves them, and how a
// bench script turns a call's input into a request: path parameters from the input, the
// rest as a GET's query string or a JSON body, as src/lib/api/request.ts sends them.

export const CALLS = {
  getAppSession: { method: 'GET', path: '/api/v1/session' },
  getSignInMethods: { method: 'GET', path: '/api/v1/sign-in-methods' },
  getDeployment: { method: 'GET', path: '/api/v1/deployment' },
  getDevUsers: { method: 'GET', path: '/api/v1/dev-users' },
  checkAvailability: { method: 'GET', path: '/api/v1/availability' },
  getRunningTimer: { method: 'GET', path: '/api/v1/timer' },
  startTimer: { method: 'POST', path: '/api/v1/organizations/:organizationId/timer/start' },
  stopTimer: { method: 'POST', path: '/api/v1/timer/stop' },
  listEntries: { method: 'GET', path: '/api/v1/organizations/:organizationId/entries' },
  getFirstEntryStart: {
    method: 'GET',
    path: '/api/v1/organizations/:organizationId/entries/first-start',
  },
  createEntry: { method: 'POST', path: '/api/v1/organizations/:organizationId/entries' },
  updateEntry: { method: 'PATCH', path: '/api/v1/organizations/:organizationId/entries/:id' },
  deleteEntry: { method: 'DELETE', path: '/api/v1/organizations/:organizationId/entries/:id' },
  listProjects: { method: 'GET', path: '/api/v1/organizations/:organizationId/projects' },
  getReport: { method: 'POST', path: '/api/v1/organizations/:organizationId/report' },
  getReportBreakdown: {
    method: 'POST',
    path: '/api/v1/organizations/:organizationId/report/breakdown',
  },
  getReportEntries: {
    method: 'POST',
    path: '/api/v1/organizations/:organizationId/report/entries',
  },
  getReportEntryTotals: {
    method: 'POST',
    path: '/api/v1/organizations/:organizationId/report/entry-totals',
  },
  getReportExport: { method: 'POST', path: '/api/v1/organizations/:organizationId/report/export' },
  listTeams: { method: 'GET', path: '/api/v1/organizations/:organizationId/teams' },
  listMembers: { method: 'GET', path: '/api/v1/organizations/:organizationId/members' },
} as const

export type CallName = keyof typeof CALLS
export type Call = (typeof CALLS)[CallName]

function segments(path: string) {
  return path.split('/').filter(Boolean)
}

export function matchPath(pattern: string, pathname: string): boolean {
  const expected = segments(pattern)
  const actual = segments(pathname)
  return (
    expected.length === actual.length &&
    expected.every((segment, i) => segment.startsWith(':') || segment === actual[i])
  )
}

export function requestOf(call: Call, input: unknown): { path: string; body?: string } {
  const rest: Record<string, unknown> =
    typeof input === 'object' && input !== null ? { ...input } : {}
  const path = segments(call.path)
    .map((segment) => {
      if (!segment.startsWith(':')) return segment
      const value = rest[segment.slice(1)]
      delete rest[segment.slice(1)]
      return encodeURIComponent(String(value))
    })
    .join('/')
  const fields = JSON.parse(JSON.stringify(rest)) as Record<string, string>
  if (call.method === 'GET') {
    const query = new URLSearchParams(fields).toString()
    return { path: `/${path}${query ? `?${query}` : ''}` }
  }
  return {
    path: `/${path}`,
    body: Object.keys(fields).length > 0 ? JSON.stringify(fields) : undefined,
  }
}

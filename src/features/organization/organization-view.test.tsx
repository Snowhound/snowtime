import { render, screen, waitFor, within } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Member } from '~/lib/members'
import type { Project } from '~/lib/projects'
import { newId } from '~/lib/query'
import type { Team } from '~/lib/teams'
import { OrganizationPage } from './organization-page'
import type { Invitation } from './queries'
import type { OrganizationTab } from './search'

// Server functions and the Better Auth client stay out of the DOM tests. Each mock answers
// from `server`, so a refetch after a mutation sees what the server would return; Better
// Auth's calls resolve to { data, error } like the real client.
const fn = vi.hoisted(() => ({
  listMembers: vi.fn(),
  listTeams: vi.fn(),
  setTeamRole: vi.fn(),
  listProjects: vi.fn(),
  getAppSession: vi.fn(),
  getAppUrl: vi.fn(),
  navigate: vi.fn(),
}))
const org = vi.hoisted(() => ({
  listInvitations: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  inviteMember: vi.fn(),
  cancelInvitation: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  removeTeam: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  update: vi.fn(),
}))
vi.mock('~/server/teams/teams.functions', () => ({
  listMembers: fn.listMembers,
  listTeams: fn.listTeams,
  setTeamRole: fn.setTeamRole,
}))
vi.mock('~/server/projects/projects.functions', () => ({ listProjects: fn.listProjects }))
vi.mock('~/server/auth/auth.functions', () => ({
  getAppSession: fn.getAppSession,
  getAppUrl: fn.getAppUrl,
}))
vi.mock('~/lib/auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/auth-client')>()),
  authClient: { organization: org },
}))
vi.mock('@tanstack/solid-router', () => ({ useNavigate: () => fn.navigate }))

const HOUR = 3_600_000
// Thursday 24 September 2026, noon in Tallinn.
const NOW = new Date('2026-09-24T09:00:00Z')
const APP_URL = 'https://snowtime.test'
const organizationId = newId()

const ids = {
  owner: newId(),
  owner2: newId(),
  admin: newId(),
  lead: newId(),
  max: newId(),
  platform: newId(),
  design: newId(),
}

function person(userId: string, name: string, orgRole: Member['orgRole']): Member {
  return {
    memberId: newId(),
    userId,
    name,
    email: `${name.split(' ')[0].toLowerCase()}@example.com`,
    image: null,
    orgRole,
    joinedAt: new Date('2026-07-01T10:00:00Z'),
    teams: [],
  }
}

interface Server {
  viewer: string
  members: Member[]
  teams: Team[]
  projects: Project[]
  invitations: (Invitation & { status: string })[]
}

// Built fresh per test: Solid stores keep signals on the objects they wrap.
let server: Server

function fixtures(): Server {
  const teams: Team[] = [
    {
      id: ids.platform,
      name: 'Platform',
      members: [
        { userId: ids.lead, role: 'lead' },
        { userId: ids.max, role: 'member' },
      ],
    },
    { id: ids.design, name: 'Design', members: [{ userId: ids.max, role: 'member' }] },
  ]
  const members = [
    person(ids.owner, 'Olivia Owner', 'owner'),
    person(ids.admin, 'Adam Admin', 'admin'),
    person(ids.lead, 'Lena Lead', 'member'),
    person(ids.max, 'Max Member', 'member'),
  ].map((mb) => ({
    ...mb,
    teams: teams.flatMap((t) =>
      t.members
        .filter((tm) => tm.userId === mb.userId)
        .map((tm) => ({ teamId: t.id, role: tm.role })),
    ),
  }))
  function project(name: string, teamIds: string[]): Project {
    return { id: newId(), name, color: '#3b82b8', archivedAt: null, teamIds }
  }
  return {
    viewer: ids.admin,
    members,
    teams,
    projects: [
      project('Snowtime', [ids.platform, ids.design]),
      project('Mobile app', [ids.platform]),
      project('Internal', []),
    ],
    invitations: [
      {
        id: newId(),
        email: 'kristjan@example.com',
        role: 'member',
        teamId: ids.platform,
        inviterId: ids.admin,
        expiresAt: new Date(NOW.getTime() + 40 * HOUR),
        status: 'pending',
      },
      {
        id: newId(),
        email: 'priit@example.com',
        role: 'admin',
        teamId: null,
        inviterId: ids.owner,
        expiresAt: new Date(NOW.getTime() - 50 * HOUR),
        status: 'pending',
      },
    ],
  }
}

function viewerRole() {
  return server.members.find((mb) => mb.userId === server.viewer)!.orgRole
}

function session() {
  return {
    activeOrganizationId: organizationId,
    role: viewerRole(),
    user: { id: server.viewer },
    organizations: [{ id: organizationId, name: 'Snowhound', slug: 'snowhound' }],
    settings: { timeZone: 'Europe/Tallinn' },
  }
}

function ok<T>(data: T) {
  return Promise.resolve({ data, error: null })
}

function renderPage(tab: OrganizationTab = 'members') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['session'], session())
  render(() => (
    <QueryClientProvider client={queryClient}>
      <OrganizationPage tab={tab} />
    </QueryClientProvider>
  ))
}

const clipboard = { writeText: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
  clipboard.writeText.mockResolvedValue(undefined)
  server = fixtures()
  fn.getAppSession.mockImplementation(async () => session())
  fn.getAppUrl.mockResolvedValue(APP_URL)
  fn.listMembers.mockImplementation(async () => server.members)
  fn.listTeams.mockImplementation(async () => server.teams)
  fn.listProjects.mockImplementation(async () => server.projects)
  fn.setTeamRole.mockImplementation(async ({ data }) => {
    server.teams = server.teams.map((t) =>
      t.id !== data.teamId
        ? t
        : {
            ...t,
            members: t.members.map((tm) =>
              tm.userId === data.userId ? { ...tm, role: data.role } : tm,
            ),
          },
    )
    return data
  })
  org.listInvitations.mockImplementation(() => ok(server.invitations))
  org.updateMemberRole.mockImplementation(({ memberId, role }) => {
    server.members = server.members.map((mb) =>
      mb.memberId === memberId ? { ...mb, orgRole: role } : mb,
    )
    return ok({ id: memberId, role })
  })
  org.removeMember.mockImplementation(({ memberIdOrEmail }) => {
    server.members = server.members.filter((mb) => mb.memberId !== memberIdOrEmail)
    return ok({ member: { id: memberIdOrEmail } })
  })
  org.inviteMember.mockImplementation(({ email, role, teamId }) => {
    const invitation = {
      id: newId(),
      email,
      role,
      teamId: teamId ?? null,
      inviterId: server.viewer,
      expiresAt: new Date(Date.now() + 48 * HOUR),
      status: 'pending',
    }
    server.invitations = [...server.invitations, invitation]
    return ok(invitation)
  })
  org.cancelInvitation.mockImplementation(({ invitationId }) => {
    server.invitations = server.invitations.filter((i) => i.id !== invitationId)
    return ok({ id: invitationId, status: 'canceled' })
  })
  org.removeTeam.mockImplementation(({ teamId }) => {
    server.teams = server.teams.filter((t) => t.id !== teamId)
    return ok({ message: 'Team removed successfully.' })
  })
})

afterEach(() => {
  vi.useRealTimers()
})

async function memberRow(name: string) {
  return (await screen.findByText(name, { selector: 'p' })).closest('li')!
}

describe('OrganizationView', () => {
  test.each([
    ['members', ids.max],
    ['team leads', ids.lead],
  ])('%s get the no-access message', async (_, userId) => {
    server.viewer = userId
    renderPage()
    expect(
      await screen.findByText('Only admins and owners manage the organization'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(fn.listMembers).not.toHaveBeenCalled()
  })

  test('the only owner keeps their role and stays; they change everyone else', async () => {
    server.viewer = ids.owner
    renderPage()
    const own = await memberRow('Olivia Owner')
    expect(within(own).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(own).getByText(/The only owner/)).toBeInTheDocument()
    expect(within(own).getByRole('button', { name: 'Remove Olivia Owner' })).toBeDisabled()

    const admin = await memberRow('Adam Admin')
    const select = within(admin).getByRole('combobox', { name: 'Role of Adam Admin' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Member', 'Admin', 'Owner'])
    await userEvent.selectOptions(select, 'owner')
    const adam = server.members.find((mb) => mb.userId === ids.admin)!
    expect(org.updateMemberRole).toHaveBeenCalledWith({
      memberId: adam.memberId,
      role: 'owner',
      organizationId,
    })
    // Two owners now, so the viewer's row is locked as their own rather than the last one.
    await waitFor(() =>
      expect(within(own).getByText(/You can't change your own role/)).toBeInTheDocument(),
    )
  })

  test('owners change another owner', async () => {
    server.viewer = ids.owner
    server.members.push(person(ids.owner2, 'Otto Owner', 'owner'))
    renderPage()
    const other = await memberRow('Otto Owner')
    expect(within(other).getByRole('combobox', { name: 'Role of Otto Owner' })).toHaveValue('owner')
    expect(within(other).getByRole('button', { name: 'Remove Otto Owner' })).toBeEnabled()
  })

  test("admins manage members and admins, but not owners or their own role, and can't grant owner", async () => {
    server.members.push(person(ids.owner2, 'Otto Owner', 'owner'))
    renderPage()
    for (const name of ['Olivia Owner', 'Otto Owner']) {
      const row = await memberRow(name)
      expect(within(row).queryByRole('combobox')).not.toBeInTheDocument()
      expect(within(row).getByText(/Only owners can change an owner/)).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: `Remove ${name}` })).toBeDisabled()
    }
    const own = await memberRow('Adam Admin')
    expect(within(own).getByText('(you)')).toBeInTheDocument()
    expect(within(own).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(own).getByRole('button', { name: 'Remove Adam Admin' })).toBeDisabled()

    const max = await memberRow('Max Member')
    const select = within(max).getByRole('combobox', { name: 'Role of Max Member' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Member', 'Admin'])
    expect(within(max).getByText('Platform')).toBeInTheDocument()
    expect(within(max).getByText('Design')).toBeInTheDocument()
    expect(within(await memberRow('Lena Lead')).getByText('· Lead')).toBeInTheDocument()
  })

  test('removes a member once confirmed', async () => {
    const { memberId } = server.members.find((mb) => mb.userId === ids.max)!
    renderPage()
    const max = await memberRow('Max Member')
    await userEvent.click(within(max).getByRole('button', { name: 'Remove Max Member' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove Max Member?' })
    expect(within(dialog).getByText(/They lose access to Snowhound/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove member' }))
    expect(org.removeMember).toHaveBeenCalledWith({ memberIdOrEmail: memberId, organizationId })
    await waitFor(() =>
      expect(screen.queryByText('Max Member', { selector: 'p' })).not.toBeInTheDocument(),
    )
  })

  test("Better Auth's refusals show, and the change is undone", async () => {
    org.updateMemberRole.mockImplementation(() =>
      Promise.resolve({
        data: null,
        error: { code: 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER', status: 403 },
      }),
    )
    renderPage()
    const select = within(await memberRow('Max Member')).getByRole('combobox', {
      name: 'Role of Max Member',
    })
    await userEvent.selectOptions(select, 'admin')
    expect(
      await screen.findByText('Only owners can change or remove an owner.'),
    ).toBeInTheDocument()
    // The row renders again from the restored cache.
    await waitFor(async () =>
      expect(
        within(await memberRow('Max Member')).getByRole('combobox', { name: 'Role of Max Member' }),
      ).toHaveValue('member'),
    )
  })

  test('the invite dialog refuses members and open invitations, then returns a link to copy', async () => {
    renderPage('invitations')
    await userEvent.click((await screen.findAllByRole('button', { name: 'Invite member' }))[0])
    const dialog = await screen.findByRole('dialog', { name: 'Invite member' })
    expect(
      within(within(dialog).getByLabelText('Role'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Member', 'Admin'])
    const email = within(dialog).getByLabelText('Email')
    const submit = within(dialog).getByRole('button', { name: 'Create link' })

    await userEvent.type(email, 'Max@Example.com')
    await userEvent.click(submit)
    expect(
      await within(dialog).findByText('max@example.com is already a member.'),
    ).toBeInTheDocument()

    await userEvent.clear(email)
    await userEvent.type(email, 'kristjan@example.com')
    await userEvent.click(submit)
    expect(
      await within(dialog).findByText(
        'kristjan@example.com already has an open invitation. Copy its link from the list.',
      ),
    ).toBeInTheDocument()
    expect(org.inviteMember).not.toHaveBeenCalled()

    await userEvent.clear(email)
    await userEvent.type(email, 'helena@example.com')
    await userEvent.selectOptions(within(dialog).getByLabelText('Team'), 'Design')
    await userEvent.click(submit)
    expect(org.inviteMember).toHaveBeenCalledWith({
      email: 'helena@example.com',
      role: 'member',
      organizationId,
      teamId: ids.design,
    })

    const created = server.invitations.at(-1)!
    const link = await screen.findByLabelText('Invitation link')
    expect(link).toHaveValue(`${APP_URL}/invitation/${created.id}`)
    expect(
      screen.getByText(/Send this link to helena@example\.com\. It works until/),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(clipboard.writeText).toHaveBeenCalledWith(`${APP_URL}/invitation/${created.id}`)
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  test('open invitations copy their link; expired ones get a new one', async () => {
    renderPage('invitations')
    const open = (await screen.findByText('kristjan@example.com')).closest('li')!
    expect(
      within(open).getByText(/Platform · invited by Adam Admin · Expires in 40 hours/),
    ).toBeInTheDocument()
    await userEvent.click(
      within(open).getByRole('button', { name: 'Copy the link for kristjan@example.com' }),
    )
    expect(clipboard.writeText).toHaveBeenCalledWith(
      `${APP_URL}/invitation/${server.invitations[0].id}`,
    )

    const expired = screen.getByText('priit@example.com').closest('li')!
    const old = server.invitations[1].id
    expect(within(expired).getByText('Expired')).toBeInTheDocument()
    expect(within(expired).queryByRole('button', { name: /Copy/ })).not.toBeInTheDocument()
    await userEvent.click(
      within(expired).getByRole('button', { name: 'New link for priit@example.com' }),
    )
    expect(org.inviteMember).toHaveBeenCalledWith({
      email: 'priit@example.com',
      role: 'admin',
      organizationId,
    })
    await waitFor(() => expect(org.cancelInvitation).toHaveBeenCalledWith({ invitationId: old }))
    const renewed = server.invitations.find((i) => i.email === 'priit@example.com')!
    expect(await screen.findByLabelText('Invitation link')).toHaveValue(
      `${APP_URL}/invitation/${renewed.id}`,
    )
  })

  test('cancels an invitation once confirmed', async () => {
    renderPage('invitations')
    const open = (await screen.findByText('kristjan@example.com')).closest('li')!
    const { id } = server.invitations[0]
    await userEvent.click(
      within(open).getByRole('button', { name: 'Cancel the invitation for kristjan@example.com' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Cancel invitation?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel invitation' }))
    expect(org.cancelInvitation).toHaveBeenCalledWith({ invitationId: id })
    await waitFor(() => expect(screen.queryByText('kristjan@example.com')).not.toBeInTheDocument())
  })

  test('makes a team member Lead and back to Member with setTeamRole', async () => {
    renderPage('teams')
    // Each change renders the card again, so it is looked up afresh.
    function platform() {
      return screen.getByRole('region', { name: 'Platform' })
    }
    function select() {
      return within(platform()).getByRole('combobox', { name: 'Team role of Max Member' })
    }
    await screen.findByRole('region', { name: 'Platform' })
    expect(within(platform()).getByText('2 members · Led by Lena Lead')).toBeInTheDocument()

    await userEvent.selectOptions(select(), 'lead')
    expect(fn.setTeamRole).toHaveBeenCalledWith({
      data: { teamId: ids.platform, userId: ids.max, role: 'lead' },
    })
    expect(
      await screen.findByText('2 members · Led by Lena Lead and Max Member'),
    ).toBeInTheDocument()

    await userEvent.selectOptions(select(), 'member')
    expect(fn.setTeamRole).toHaveBeenLastCalledWith({
      data: { teamId: ids.platform, userId: ids.max, role: 'member' },
    })
  })

  test('deleting a team names the projects that lose it and those that open up', async () => {
    renderPage('teams')
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Platform' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete team' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete Platform?' })
    expect(
      within(dialog).getByText(
        '2 members leave the team but stay in the organization, and their time stays in reports. ' +
          'Snowtime and Mobile app lose this team. ' +
          'Mobile app then becomes available to the whole organization.',
      ),
    ).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete team' }))
    expect(org.removeTeam).toHaveBeenCalledWith({ teamId: ids.platform, organizationId })
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Platform' })).not.toBeInTheDocument(),
    )
  })

  test('changing tabs keeps the tab in the URL', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: /Teams/ }))
    expect(fn.navigate).toHaveBeenCalledWith({
      to: '/organization',
      search: { tab: 'teams' },
      replace: true,
    })
  })
})

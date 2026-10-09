import { signInHeaders } from '../perf/lib/app'
import { COMPANY, USERS } from '../perf/lib/database'
import type { OAuthObservation } from './oauth-flow'

export async function authWritesFlow(
  app: { url: string },
  observe: (result: OAuthObservation) => void,
) {
  const ids = new Map<string, string>()
  let cookie = ''
  let organizationId = ''
  let ownerId = ''
  let invitationId = ''
  function mask(text: string) {
    let result = text.replaceAll(app.url, '$HOST')
    for (const [id, paired] of ids) result = result.replaceAll(id, paired)
    return result
  }
  async function call(
    label: string,
    path: string,
    body: unknown,
    expected: number,
    options: { cookie?: string; origin?: string; raw?: string } = {},
  ) {
    const response = await fetch(
      `${app.url}${path.startsWith('/api/') ? path : `/api/auth${path}`}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          origin: options.origin ?? app.url,
          cookie: options.cookie ?? cookie,
        },
        body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
        redirect: 'manual',
      },
    )
    let text = await response.text()
    const data = response.ok && text ? JSON.parse(text) : null
    if ((response.ok && path === '/organization/create') || label.startsWith('invite ')) {
      for (const id of path === '/organization/create'
        ? [data.id, data.members[0].id]
        : [data.id]) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
          throw new Error('Generated ID is not UUIDv7')
        ids.set(id, `$id${ids.size}`)
      }
    }
    if (response.ok && label === 'new organization members') {
      for (const member of data)
        if (member.email === USERS.member.email) {
          if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
              member.memberId,
            )
          )
            throw new Error('Generated membership ID is not UUIDv7')
          ids.set(member.memberId, `$id${ids.size}`)
        }
    }
    function dates(value: unknown) {
      if (Array.isArray(value)) {
        for (const item of value) dates(item)
        return
      }
      if (!value || typeof value !== 'object') return
      const object = value as Record<string, unknown>
      const created =
        (typeof object.id === 'string' && ids.has(object.id)) ||
        (typeof object.memberId === 'string' && ids.has(object.memberId))
      const timer = object.id === '01900000-0000-7000-8050-000000000001'
      for (const [key, value] of Object.entries(object)) {
        if (
          ((created && (key === 'createdAt' || key === 'expiresAt' || key === 'joinedAt')) ||
            (timer && (key === 'startedAt' || key === 'stoppedAt')) ||
            key === 'signedInAt') &&
          typeof value === 'string'
        ) {
          if (!Number.isFinite(Date.parse(value))) throw new Error('Invalid advancing timestamp')
          text = text.replaceAll(value, `$${key}`)
        } else dates(value)
      }
    }
    dates(data)
    observe({ label, status: response.status, expected, text: mask(text) })
    return data
  }
  const routes = [
    'update-user',
    'organization/set-active',
    'organization/check-slug',
    'organization/create',
    'organization/update',
    'organization/update-member-role',
    'organization/remove-member',
    'organization/cancel-invitation',
    'organization/leave',
  ]
  const valid = [
    { name: 'Name' },
    {},
    { slug: 'free' },
    { name: 'New', slug: 'new' },
    { data: { name: 'New' } },
    { role: 'member', memberId: 'missing' },
    { memberIdOrEmail: 'missing' },
    { invitationId: 'missing' },
    { organizationId: 'missing' },
  ]
  for (const [i, path] of routes.entries()) {
    for (const body of [null, [], {}, valid[i]])
      await call(
        `signed out ${path} ${JSON.stringify(body)}`,
        `/${path}`,
        body,
        body === valid[i] ||
          (path === 'organization/set-active' && body !== null && !Array.isArray(body)) ||
          (path === 'update-user' && body !== null && !Array.isArray(body))
          ? 401
          : 400,
      )
  }
  cookie = (await signInHeaders(app)).cookie
    .split('; ')
    .filter((p) => !p.includes('session_data'))
    .join('; ')
  for (const [path, body] of [
    [
      'organization/create',
      { name: 3, slug: false, logo: 7, metadata: [], keepCurrentActiveOrganization: 'yes' },
    ],
    [
      'organization/update',
      { data: { name: 3, slug: false, logo: 7, metadata: [] }, organizationId: 3 },
    ],
    ['organization/set-active', { organizationId: 3, organizationSlug: null }],
    ['organization/update-member-role', { role: [3], memberId: false, organizationId: null }],
    ['organization/remove-member', { memberIdOrEmail: 3, organizationId: false }],
    ['organization/cancel-invitation', { invitationId: null }],
    ['organization/leave', { organizationId: false }],
  ] as const)
    await call(`ordered ${path}`, `/${path}`, body, 400)
  await call('malformed JSON', '/organization/create', {}, 400, { raw: '{' })
  await call('wrong origin', '/update-user', { name: 'Bad' }, 403, {
    origin: 'https://evil.example',
  })
  for (const name of ['', '  ', '\uFEFF', '\u0085', null, 3, 'a'.repeat(101), '😀'.repeat(51)])
    await call(
      `profile invalid ${JSON.stringify(name)}`,
      '/update-user',
      { name },
      name === '\u0085' ? 200 : 400,
    )
  await call('profile no fields', '/update-user', { ignored: true }, 400)
  await call(
    'profile email forbidden',
    '/update-user',
    { email: 'new@example.com', name: 'New' },
    400,
  )
  await call(
    'profile preserves whitespace',
    '/update-user',
    { name: '  Ported Name  ', image: 'https://example.com/image' },
    200,
  )
  await call('profile session', '/api/v1/session', undefined, 200)
  await call('profile clear image', '/update-user', { image: null }, 200)
  await call('slug taken', '/organization/check-slug', { slug: COMPANY.slug }, 400)
  await call('slug free including reserved', '/organization/check-slug', { slug: 'api' }, 200)
  for (const [name, slug] of [
    ['', 'free'],
    ['  ', 'free'],
    ['a'.repeat(101), 'free'],
    ['New', 'UPPER'],
    ['New', 'api'],
    ['New', 'a'.repeat(49)],
  ])
    await call(`create invalid ${name.length} ${slug}`, '/organization/create', { name, slug }, 400)
  await call(
    'create duplicate before name hook',
    '/organization/create',
    { name: ' ', slug: COMPANY.slug },
    400,
  )
  await call('profile image at byte bound', '/update-user', { image: 'a'.repeat(2048) }, 200)
  const created = await call(
    'create organization',
    '/organization/create',
    {
      name: '  Port Organization  ',
      slug: 'auth-port',
      metadata: { z: 'kept', a: { z: 1, a: 2, '2': 'second', '1': 'first' } },
      userId: 'ignored',
    },
    200,
  )
  organizationId = created.id
  ownerId = created.members[0].id
  await call(
    'set active by slug',
    '/organization/set-active',
    { organizationSlug: 'auth-port' },
    200,
  )
  await call('set active by default', '/organization/set-active', {}, 200)
  await call(
    'set active null wins over slug',
    '/organization/set-active',
    { organizationId: null, organizationSlug: 'auth-port' },
    200,
  )
  await call('set active null again', '/organization/set-active', { organizationId: null }, 200)
  await call('set active no default', '/organization/set-active', {}, 200)
  await call('update no active', '/organization/update', { data: {} }, 400)
  await call(
    'set active missing slug',
    '/organization/set-active',
    { organizationSlug: 'missing' },
    400,
  )
  await call(
    'set active missing id',
    '/organization/set-active',
    { organizationId: 'missing' },
    403,
  )
  await call(
    'update nonmember',
    '/organization/update',
    { organizationId: 'missing', data: { name: 'New' } },
    400,
  )
  await call('set active id', '/organization/set-active', { organizationId }, 200)
  await call(
    'update slug collision precedes hook',
    '/organization/update',
    { data: { slug: COMPANY.slug } },
    400,
  )
  await call('update slug read only', '/organization/update', { data: { slug: 'auth-port' } }, 400)
  await call('update invalid name', '/organization/update', { data: { name: '  ' } }, 400)
  await call(
    'update organization',
    '/organization/update',
    { data: { name: 'Renamed', logo: 'https://example.com/logo', metadata: { changed: true } } },
    200,
  )
  await call('update duplicate metadata preserves order', '/organization/update', {}, 200, {
    raw: '{"data":{"metadata":{"old":0}},"data":{"metadata":{"z":1,"a":2,"z":3,"2":"second","1":"first"}}}',
  })
  await call(
    'update bounded metadata and logo',
    '/organization/update',
    {
      data: { metadata: { v: 'a'.repeat(4088) }, logo: 'a'.repeat(2048) },
    },
    200,
  )
  await call(
    'update ignores large unknown object',
    '/organization/update',
    {
      data: { name: 'Renamed' },
      pad: Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`key${i}`, 0])),
    },
    200,
  )
  await call(
    'update organization no fields',
    '/organization/update',
    { data: { ignored: true } },
    400,
  )
  await call(
    'role last owner',
    '/organization/update-member-role',
    { memberId: ownerId, role: 'member' },
    400,
  )
  await call('remove last owner', '/organization/remove-member', { memberIdOrEmail: ownerId }, 400)
  await call(
    'role invalid',
    '/organization/update-member-role',
    { memberId: ownerId, role: 'owner,unknown' },
    400,
  )
  await call(
    'role empty array',
    '/organization/update-member-role',
    { memberId: ownerId, role: [] },
    400,
  )
  await call(
    'role normalize preserves duplicates',
    '/organization/update-member-role',
    { memberId: ownerId, role: [' owner ', 'admin,owner'] },
    200,
  )
  await call(
    'role missing member',
    '/organization/update-member-role',
    { memberId: 'missing', role: 'member' },
    400,
  )
  await call(
    'remove missing member',
    '/organization/remove-member',
    { memberIdOrEmail: 'missing' },
    400,
  )
  await call(
    'cancel missing invitation',
    '/organization/cancel-invitation',
    { invitationId: 'missing' },
    400,
  )
  await call('set active seeded', '/organization/set-active', { organizationId: COMPANY.id }, 200)
  const members = await call(
    'seeded members',
    `/api/v1/organizations/${COMPANY.id}/members`,
    undefined,
    200,
  )
  const memberId = members.find((m: { email: string }) => m.email === USERS.member.email).memberId
  await call(
    'role cross organization',
    '/organization/update-member-role',
    { memberId: ownerId, role: 'member' },
    403,
  )
  await call(
    'remove cross organization',
    '/organization/remove-member',
    { memberIdOrEmail: ownerId },
    400,
  )
  const memberCookie = (await signInHeaders(app, 'member')).cookie
    .split('; ')
    .filter((p) => !p.includes('session_data'))
    .join('; ')
  await call(
    'member role forbidden',
    '/organization/update-member-role',
    { organizationId: COMPANY.id, memberId, role: 'admin' },
    403,
    { cookie: memberCookie },
  )
  await call(
    'member remove self forbidden',
    '/organization/remove-member',
    { organizationId: COMPANY.id, memberIdOrEmail: memberId },
    401,
    { cookie: memberCookie },
  )
  await call(
    'role promote admin',
    '/organization/update-member-role',
    { memberId, role: 'admin' },
    200,
  )
  await call(
    'admin cannot demote owner',
    '/organization/update-member-role',
    {
      organizationId: COMPANY.id,
      memberId: members.find((m: { email: string }) => m.email === USERS.admin.email).memberId,
      role: 'member',
    },
    403,
    { cookie: memberCookie },
  )
  await call(
    'admin cannot promote owner',
    '/organization/update-member-role',
    { organizationId: COMPANY.id, memberId, role: 'owner' },
    403,
    { cookie: memberCookie },
  )
  await call(
    'admin renames organization',
    '/organization/update',
    { organizationId: COMPANY.id, data: { name: 'Lumen Works' } },
    200,
    { cookie: memberCookie },
  )
  await call(
    'role restore member',
    '/organization/update-member-role',
    { memberId, role: 'member' },
    200,
  )
  await call(
    'member update forbidden',
    '/organization/update',
    { organizationId: COMPANY.id, data: { name: 'Bad' } },
    403,
    { cookie: memberCookie },
  )
  await call(
    'member remove forbidden',
    '/organization/remove-member',
    { organizationId: COMPANY.id, memberIdOrEmail: USERS.admin.email },
    400,
    { cookie: memberCookie },
  )
  const invited = await call(
    'invite for cancellation',
    `/api/v1/organizations/${COMPANY.id}/invitations`,
    { email: 'cancel-port@example.com', role: 'member', teamId: null },
    200,
  )
  invitationId = invited.id
  await call('member cancel forbidden', '/organization/cancel-invitation', { invitationId }, 403, {
    cookie: memberCookie,
  })
  await call('cancel invitation', '/organization/cancel-invitation', { invitationId }, 200)
  await call('cancel invitation again', '/organization/cancel-invitation', { invitationId }, 200)
  await call('canceled preview', `/api/v1/invitations/${invitationId}`, undefined, 200)
  await call(
    'member starts timer',
    `/api/v1/organizations/${COMPANY.id}/timer/start`,
    { id: '01900000-0000-7000-8050-000000000001', description: 'Removal timer', projectId: null },
    200,
    { cookie: memberCookie },
  )
  const otherInvite = await call(
    'invite another organization',
    `/api/v1/organizations/${organizationId}/invitations`,
    { email: USERS.member.email, role: 'member', teamId: null },
    200,
  )
  await call(
    'accept another organization',
    `/api/v1/invitations/${otherInvite.id}/accept`,
    {},
    200,
    { cookie: memberCookie },
  )
  const otherMembers = await call(
    'new organization members',
    `/api/v1/organizations/${organizationId}/members`,
    undefined,
    200,
  )
  const otherMembership = otherMembers.find(
    (m: { email: string }) => m.email === USERS.member.email,
  ).memberId
  await call(
    'remove member by ID in another organization',
    '/organization/remove-member',
    { organizationId, memberIdOrEmail: otherMembership },
    200,
  )
  const leaveInvite = await call(
    'invite for leaving',
    `/api/v1/organizations/${organizationId}/invitations`,
    { email: USERS.member.email, role: 'member', teamId: null },
    200,
  )
  await call('accept before leaving', `/api/v1/invitations/${leaveInvite.id}/accept`, {}, 200, {
    cookie: memberCookie,
  })
  const leavingMembers = await call(
    'new organization members',
    `/api/v1/organizations/${organizationId}/members`,
    undefined,
    200,
  )
  if (!leavingMembers.some((m: { email: string }) => m.email === USERS.member.email))
    throw new Error('Member did not join before leaving')
  await call('leave organization', '/organization/leave', { organizationId }, 200, {
    cookie: memberCookie,
  })
  const preserved = await call(
    'timer preserved after removing other organization',
    '/api/v1/timer',
    undefined,
    200,
    { cookie: memberCookie },
  )
  if (preserved?.id !== '01900000-0000-7000-8050-000000000001' || preserved.stoppedAt !== null)
    throw new Error('Removal stopped a timer in another organization')
  await call(
    'remove member by email',
    '/organization/remove-member',
    { memberIdOrEmail: USERS.member.email.toUpperCase() },
    200,
  )
  const removedEntries = await call(
    'removed entries retained and stopped',
    `/api/v1/organizations/${COMPANY.id}/entries?from=2026-09-30T00:00:00.000Z&to=2026-10-01T00:00:00.000Z`,
    undefined,
    200,
  )
  const stopped = removedEntries.find(
    (e: { id: string }) => e.id === '01900000-0000-7000-8050-000000000001',
  )
  if (!stopped?.stoppedAt || Date.parse(stopped.stoppedAt) <= Date.parse(stopped.startedAt))
    throw new Error('Removed member timer did not stop')
  await call('removed timer stopped', '/api/v1/timer', undefined, 200, { cookie: memberCookie })
  await call('teams after removal', `/api/v1/organizations/${COMPANY.id}/teams`, undefined, 200)
  await call('members after removal', `/api/v1/organizations/${COMPANY.id}/members`, undefined, 200)
  await call(
    'remove member again',
    '/organization/remove-member',
    { memberIdOrEmail: USERS.member.email },
    400,
  )
  for (let i = 1; i < 10; i++)
    await call(
      `create cap ${i}`,
      '/organization/create',
      { name: `Cap ${i}`, slug: `auth-cap-${i}`, keepCurrentActiveOrganization: true },
      i < 9 ? 200 : 403,
    )
  await call(
    'create cap precedes duplicate and hook',
    '/organization/create',
    { name: ' ', slug: COMPANY.slug },
    403,
  )
  await call('owner cannot leave alone', '/organization/leave', { organizationId }, 400)
  await call('leave missing membership', '/organization/leave', { organizationId: 'missing' }, 400)
  if (!memberId) throw new Error('Seeded member has no membership ID')
}

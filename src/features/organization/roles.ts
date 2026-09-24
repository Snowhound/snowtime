// Who may change whom (prototypes/README.md, organization.html). Owners change any role;
// admins manage members and admins but not owners, and can't grant owner; nobody changes
// their own role; the last owner can't be demoted or removed. Better Auth's organization
// plugin refuses most of this itself, so the view hides or disables what it would refuse.
import type { Member } from '~/lib/members'
import { m } from '~/paraglide/messages.js'

export type OrgRole = Member['orgRole']

export const ORG_ROLES = ['owner', 'admin', 'member'] as const satisfies readonly OrgRole[]

export const ROLE_LABELS = {
  owner: m.organization_role_owner,
  admin: m.organization_role_admin,
  member: m.organization_role_member,
} satisfies Record<OrgRole, () => string>

export interface Viewer {
  userId: string
  role: OrgRole
}

// Roles the viewer may give: only owners make owners.
export function grantableRoles(viewer: Viewer): OrgRole[] {
  return viewer.role === 'owner' ? ['member', 'admin', 'owner'] : ['member', 'admin']
}

// Why the viewer can't change or remove a member, or null when they can.
export type MemberLock = 'last_owner' | 'self' | 'owner'

export function memberLock(
  viewer: Viewer,
  target: Member,
  members: readonly Member[],
): MemberLock | null {
  if (target.orgRole === 'owner' && members.filter((m) => m.orgRole === 'owner').length <= 1) {
    return 'last_owner'
  }
  if (target.userId === viewer.userId) return 'self'
  if (target.orgRole === 'owner' && viewer.role !== 'owner') return 'owner'
  return null
}

const GRANT_ORDER = ['member', 'admin', 'owner'] as const satisfies readonly OrgRole[]

// The role select's options: what the viewer may grant, plus the member's current role.
export function roleOptions(viewer: Viewer, target: Member): OrgRole[] {
  const grantable = grantableRoles(viewer)
  return GRANT_ORDER.filter((r) => grantable.includes(r) || r === target.orgRole)
}

// Owners first, then admins, then members, each by name.
export function byRoleAndName(a: Member, b: Member) {
  return ORG_ROLES.indexOf(a.orgRole) - ORG_ROLES.indexOf(b.orgRole) || a.name.localeCompare(b.name)
}

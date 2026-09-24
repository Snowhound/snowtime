// What the app frame needs about the signed-in user: their organizations and role in each,
// which one is active, their settings, and an open invitation when they have no
// organization yet (docs/architecture.md, "Tenancy" and "User settings").
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import type { Database } from '~/db'
import { invitation, member, organization, userSettings } from '~/db/schema'
import { strongestRole } from '../scope.server'

export async function appSession(
  db: Database,
  user: { id: string; email: string },
  activeOrganizationId: string | null,
  now = new Date(),
) {
  const memberships = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, user.id))
    .orderBy(asc(organization.name), asc(organization.id))
  const organizations = memberships.map((o) => ({ ...o, role: strongestRole(o.role) }))

  // The session may have no active organization yet, or one the user has since left; the
  // first by name stands in, and the caller saves it to the session.
  const active =
    organizations.find((o) => o.id === activeOrganizationId) ?? organizations.at(0) ?? null

  const settings = (
    await db
      .select({
        timeZone: userSettings.timeZone,
        weekStart: userSettings.weekStart,
        locale: userSettings.locale,
        theme: userSettings.theme,
        timerLayout: userSettings.timerLayout,
        showSummary: userSettings.showSummary,
        appIcon: userSettings.appIcon,
      })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
  ).at(0)

  // Only asked when there is no organization: such a user goes to their invitation, or to
  // create an organization. Better Auth compares invited addresses case-insensitively.
  let invitationId: string | null = null
  if (!active) {
    const [open] = await db
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          sql`lower(${invitation.email}) = ${user.email.toLowerCase()}`,
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, now),
        ),
      )
      .orderBy(asc(invitation.expiresAt))
      .limit(1)
    invitationId = open?.id ?? null
  }

  return {
    organizations,
    activeOrganizationId: active?.id ?? null,
    role: active?.role ?? null,
    settings: settings ?? null,
    invitationId,
  }
}

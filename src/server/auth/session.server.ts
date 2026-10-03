// What the app frame needs about the signed-in user: their organizations and role in each, the
// default one (the session's active organization), their settings, the fill summary for the
// taglines, and an open invitation when they have no organization yet (docs/architecture/data.md,
// "Tenancy"; docs/architecture/timer.md, "User settings"; and docs/architecture/taglines.md).
import { and, asc, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { Database } from '~/db'
import { invitation, member, organization, timeEntry } from '~/db/schema'
import { localDate } from '~/lib/calendar'
import { userRegion } from '~/lib/holidays/region'
import { fillRange, fillSummary } from '~/lib/taglines/fill'
import { MAX_ENTRY_MS } from '../entries/entries.schemas'
import { notDeleted } from '../queries.server'
import { strongestRole } from '../scope.server'
import { findSettings } from '../settings/settings.server'

export async function appSession(
  db: Database,
  user: { id: string; email: string; createdAt: Date },
  activeOrganizationId: string | null,
  now = new Date(),
) {
  // Every signed-in page waits for this, so independent reads share a round trip.
  const [organizations, settings] = await Promise.all([
    organizationsOf(db, user.id),
    findSettings(db, user.id),
  ])

  // The session may have no active organization yet, or one the user has since left; the
  // first by name stands in, and the caller saves it to the session.
  const active =
    organizations.find((o) => o.id === activeOrganizationId) ?? organizations.at(0) ?? null

  const [fill, invitationId] = await Promise.all([
    settings ? fillOf(db, user, organizations, settings, now.getTime()) : null,
    active ? null : openInvitation(db, user.email, now),
  ])

  return {
    organizations,
    activeOrganizationId: active?.id ?? null,
    settings: settings ?? null,
    fill,
    invitationId,
  }
}

// The user's organizations by name, with their strongest role in each.
export async function organizationsOf(db: Database, userId: string) {
  const memberships = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      issueLinks: organization.issueLinks,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name), asc(organization.id))
  return memberships.map((o) => ({ ...o, role: strongestRole(o.role) }))
}

// Only asked when there is no organization: such a user goes to their invitation, or to
// create an organization. Better Auth compares invited addresses case-insensitively.
async function openInvitation(db: Database, email: string, now: Date) {
  const [open] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        sql`lower(${invitation.email}) = ${email.toLowerCase()}`,
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, now),
      ),
    )
    .orderBy(asc(invitation.expiresAt))
    .limit(1)
  return open?.id ?? null
}

// The user's entries since the start of last month in their organizations, and a running
// timer from before then, summed in their zone and region. The two halves of the union each
// use an index; one query with OR between them scans the table.
async function fillOf(
  db: Database,
  user: { id: string; createdAt: Date },
  organizations: { id: string }[],
  settings: NonNullable<Awaited<ReturnType<typeof findSettings>>>,
  now: number,
) {
  const range = fillRange(now, settings.timeZone)
  // An entry lasts at most MAX_ENTRY_MS, so one overlapping the range started after this.
  const earliest = new Date(range.from - MAX_ENTRY_MS)
  const columns = { startedAt: timeEntry.startedAt, stoppedAt: timeEntry.stoppedAt }
  const entries = await db
    .select(columns)
    .from(timeEntry)
    .where(
      and(
        inArray(
          timeEntry.organizationId,
          organizations.map((o) => o.id),
        ),
        eq(timeEntry.userId, user.id),
        notDeleted(timeEntry),
        gte(timeEntry.startedAt, earliest),
        lt(timeEntry.startedAt, new Date(now)),
      ),
    )
    .unionAll(
      db
        .select(columns)
        .from(timeEntry)
        .where(
          and(
            eq(timeEntry.userId, user.id),
            isNull(timeEntry.stoppedAt),
            notDeleted(timeEntry),
            lt(timeEntry.startedAt, earliest),
          ),
        ),
    )
  return fillSummary(entries, {
    now,
    timeZone: settings.timeZone,
    weekStart: settings.weekStart,
    region: userRegion(settings),
    since: localDate(user.createdAt.getTime(), settings.timeZone),
  })
}

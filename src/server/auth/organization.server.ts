// Organization settings the app keeps in columns of its own, beside Better Auth's
// (docs/architecture.md, "Tenancy"). Better Auth's organization client renames an
// organization; these cover what the plugin doesn't know about.
import { eq } from 'drizzle-orm'
import type { Database } from '~/db'
import { organization } from '~/db/schema'
import { AppError } from '../errors'
import { isAdmin, type Scope } from '../scope.server'
import type { UpdateIssueLinksInput } from './auth.schemas'

// Sets where ticket chips link, or turns the links off with null. Admins and owners only.
export async function updateIssueLinks(db: Database, scope: Scope, input: UpdateIssueLinksInput) {
  if (!isAdmin(scope)) throw new AppError('FORBIDDEN', 'organization_forbidden')
  const [updated] = await db
    .update(organization)
    .set({ issueLinks: input.issueLinks })
    .where(eq(organization.id, scope.organizationId))
    .returning({ id: organization.id, issueLinks: organization.issueLinks })
  return updated
}

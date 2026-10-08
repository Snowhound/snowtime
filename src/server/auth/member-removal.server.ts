import { createAuthMiddleware } from 'better-auth/api'
import type { Database } from '~/db'
import { withActor } from '~/db/actor'
import { removeMemberTeams } from '../teams/teams.server'
import { stopTimerOfRemovedMember } from '../timer/timer.server'

// The plugin's afterRemoveMember hook misses /organization/leave.
export function memberRemovalHook(db: Database) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/organization/remove-member' && ctx.path !== '/organization/leave')
      return undefined
    const returned = ctx.context.returned
    if (typeof returned !== 'object' || !returned) return undefined
    const removed = 'member' in returned ? returned.member : returned
    if (
      !removed ||
      typeof removed !== 'object' ||
      !('userId' in removed) ||
      typeof removed.userId !== 'string' ||
      !('organizationId' in removed) ||
      typeof removed.organizationId !== 'string'
    )
      return undefined
    const { userId, organizationId } = removed
    const actor = ctx.context.session?.user.id ?? userId
    await withActor(actor, async () => {
      await stopTimerOfRemovedMember(db, userId, organizationId)
      await removeMemberTeams(db, userId, organizationId)
    })
    return undefined
  })
}

import { APIError, createAuthMiddleware } from 'better-auth/api'
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
    if (typeof returned !== 'object' || !returned || returned instanceof APIError) return undefined
    const removed = ('member' in returned ? returned.member : returned) as {
      userId: string
      organizationId: string
    }
    const actor = ctx.context.session?.user.id ?? removed.userId
    await withActor(actor, async () => {
      await stopTimerOfRemovedMember(db, removed.userId, removed.organizationId)
      await removeMemberTeams(db, removed.userId, removed.organizationId)
    })
    return undefined
  })
}

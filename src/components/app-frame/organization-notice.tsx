// Tells the user when this tab has followed the session to another organization: tabs share
// the session's active one, so a switch in another tab moves this one too, once it reads the
// session again (docs/architecture.md, "Tenancy"). The same happens when the user no longer
// belongs to the organization this tab showed. The pages follow on their own, keyed by
// organization; the routes load again, so their loaders and role checks run for the new one.
import { useQuery, useQueryClient } from '@tanstack/solid-query'
import { useRouter } from '@tanstack/solid-router'
import BuildingIcon from 'lucide-solid/icons/building'
import { Show, createEffect, createSignal, on } from 'solid-js'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { sessionQuery, switchedHere } from '~/lib/session'
import { m } from '~/paraglide/messages.js'

interface Followed {
  organization: string
  // The organization this tab showed, when the user no longer belongs to it.
  left?: string
}

export function OrganizationNotice() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const session = useQuery(() => sessionQuery)
  const [followed, setFollowed] = createSignal<Followed>()

  // The names of the organizations as this tab last showed them, to name one the user left.
  // The session's data is a store that changes in place, so its ids are tracked, not it.
  let names = new Map<string, string>()
  createEffect(
    on(
      [() => session.data?.user.id, () => session.data?.activeOrganizationId],
      ([userId, to], previous) => {
        const organizations = session.data?.organizations ?? []
        const before = names
        names = new Map(organizations.map((o) => [o.id, o.name]))
        const [previousUserId, from] = previous ?? []
        if (!userId || userId !== previousUserId || !from || !to || from === to) return
        if (switchedHere(queryClient, from)) {
          setFollowed(undefined)
          return
        }
        setFollowed({
          organization: names.get(to) ?? '',
          left: names.has(from) ? undefined : before.get(from),
        })
        void router.invalidate()
      },
    ),
  )

  return (
    <Show when={followed()}>
      {(notice) => (
        <Alert class="mb-6 flex flex-col gap-3 py-3 sm:flex-row sm:items-center [&>svg]:top-3 sm:[&>svg]:top-1/2 sm:[&>svg]:-translate-y-1/2 [&>svg~*]:pl-8">
          <BuildingIcon class="size-5" aria-hidden="true" />
          <div class="flex-1">
            <AlertTitle class="text-sm">
              {m.organization_followed_title({ organization: notice().organization })}
            </AlertTitle>
            <AlertDescription class="text-muted-foreground text-[13px]">
              <Show when={notice().left} fallback={m.organization_followed_switched()}>
                {(left) => m.organization_followed_left({ previous: left() })}
              </Show>
            </AlertDescription>
          </div>
          <div class="flex shrink-0 items-center">
            <Button variant="outline" size="sm" onClick={() => setFollowed(undefined)}>
              {m.organization_followed_dismiss()}
            </Button>
          </div>
        </Alert>
      )}
    </Show>
  )
}

import { useQuery } from '@tanstack/solid-query'
import LockIcon from 'lucide-solid/icons/lock'
import { Show } from 'solid-js'
import { PageTitle } from '~/components/page-title'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { organizationIn, sessionQuery } from '~/lib/session'
import { m } from '~/paraglide/messages.js'
import { OrganizationView } from './organization-view'
import type { OrganizationTab } from './search'

// Admins and owners manage the organization; members and team leads, whose organization
// role is member, get a no-access message. The view starts afresh in another organization.
export function OrganizationPage(props: { organizationId: string; tab: OrganizationTab }) {
  const session = useQuery(() => sessionQuery)
  return (
    <Show when={session.data}>
      {(data) => (
        <Show when={props.organizationId} keyed>
          {(organizationId) => {
            function organization() {
              return organizationIn(data(), organizationId)
            }
            return (
              <Show
                when={isAdmin(organization()?.role) && organization()}
                fallback={<NoAccess organizationName={organization()?.name ?? ''} />}
              >
                {(org) => (
                  <OrganizationView
                    organizationId={organizationId}
                    organizationName={org().name}
                    slug={org().slug}
                    viewer={{ userId: data().user.id, role: org().role }}
                    zone={data().settings?.timeZone ?? 'UTC'}
                    tab={props.tab}
                  />
                )}
              </Show>
            )
          }}
        </Show>
      )}
    </Show>
  )
}

function isAdmin(role: string | undefined) {
  return role === 'owner' || role === 'admin'
}

function NoAccess(props: { organizationName: string }) {
  return (
    <div class="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div class="relative flex min-w-0 flex-col gap-1">
        <PageTitle title={m.nav_organization()} />
        <p class="scene-text text-muted-foreground min-w-0 truncate text-sm">
          {props.organizationName}
        </p>
      </div>
      <Alert>
        <LockIcon aria-hidden="true" />
        <AlertTitle>{m.organization_no_access_title()}</AlertTitle>
        <AlertDescription>{m.organization_no_access_description()}</AlertDescription>
      </Alert>
    </div>
  )
}

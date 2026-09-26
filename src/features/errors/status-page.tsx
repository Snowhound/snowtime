import { useQuery } from '@tanstack/solid-query'
import { Link } from '@tanstack/solid-router'
import type { JSX } from 'solid-js'
import { Match, Switch } from 'solid-js'
import { AppFrame, useInAppFrame } from '~/components/app-frame/app-frame'
import { AuthHeading, AuthIcon, AuthLayout } from '~/components/auth-layout/auth-layout'
import { buttonVariants } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { defaultOrganization, organizationIn, sessionQuery } from '~/lib/session'
import { m } from '~/paraglide/messages.js'

// The not-found and error pages' frame. A route under the signed-in layout shows them inside
// the app frame. Elsewhere, such as an unknown path or a failed layout, the page picks the
// frame: the app frame for a member of an organization, otherwise the auth layout. Both
// follow the appearance settings, the account's or the device's. Below the page's own
// actions is the way home.
export function StatusPage(props: {
  icon: JSX.Element
  title: string
  description: string
  children?: JSX.Element
}) {
  const session = useQuery(() => sessionQuery)
  const inAppFrame = useInAppFrame()
  // The organization the page belongs to: the app frame's, or else the default one.
  function organization() {
    const data = session.data
    if (!data) return undefined
    const framed = inAppFrame()
    return (framed && organizationIn(data, framed)) || defaultOrganization(data) || undefined
  }
  function member() {
    const data = session.data
    const shown = organization()
    return data && shown ? { session: data, organizationId: shown.id } : undefined
  }
  function home() {
    const slug = organization()?.slug
    if (slug)
      return { to: '/$org/timer', params: { org: slug }, label: m.page_go_to_timer() } as const
    if (!session.data) return { to: '/sign-in', label: m.auth_go_to_sign_in() } as const
    return { to: '/', label: m.auth_continue() } as const
  }

  function content() {
    return (
      <>
        <AuthIcon>{props.icon}</AuthIcon>
        <AuthHeading title={props.title} description={props.description} />
        <div class="grid gap-2">
          {props.children}
          <Link
            to={home().to}
            params={'params' in home() ? home().params : undefined}
            class={buttonVariants({ variant: 'outline' })}
          >
            {home().label}
          </Link>
        </div>
      </>
    )
  }

  function card() {
    return (
      <Card class="mx-auto mt-6 flex max-w-sm flex-col gap-6 p-6 sm:mt-16 sm:p-8">{content()}</Card>
    )
  }

  return (
    <Switch fallback={<AuthLayout>{content()}</AuthLayout>}>
      <Match when={inAppFrame()}>{card()}</Match>
      <Match when={member()}>
        {(frame) => (
          <AppFrame session={frame().session} organizationId={frame().organizationId}>
            {card()}
          </AppFrame>
        )}
      </Match>
    </Switch>
  )
}

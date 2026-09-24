import { queryOptions, useQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useRouter } from '@tanstack/solid-router'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import ClockIcon from 'lucide-solid/icons/clock'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import { Match, Show, Switch, createSignal } from 'solid-js'
import * as v from 'valibot'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import { authClient } from '~/lib/auth-client'
import { errorMessage } from '~/lib/errors'
import { sessionQuery } from '~/lib/session'
import { signInMethodsQuery } from '~/lib/sign-in-methods'
import { m } from '~/paraglide/messages.js'
import { getInvitation } from '~/server/auth/auth.functions'
import { Uuidv7 } from '~/server/schemas'
import { AuthHeading, AuthIcon, AuthLayout } from './auth-layout'
import { FormAlert, PasswordSignIn, ProviderButtons } from './sign-in-methods'

// A malformed id can't match an invitation, so it shows as closed without asking.
export function invitationQuery(id: string) {
  return queryOptions({
    queryKey: ['invitation', id],
    queryFn: () => (v.is(Uuidv7, id) ? getInvitation({ data: { id } }) : null),
  })
}

const AS_ROLE = {
  member: m.invitation_as_member,
  admin: m.invitation_as_admin,
  owner: m.invitation_as_owner,
}

export function InvitationPage(props: { id: string; initialError?: string }) {
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const invitation = useQuery(() => invitationQuery(props.id))
  const session = useQuery(() => sessionQuery)
  const methods = useQuery(() => signInMethodsQuery)
  const [error, setError] = createSignal<string | null>(
    props.initialError ? m.sign_in_error_failed() : null,
  )
  const [accepting, setAccepting] = createSignal(false)

  function path() {
    return `/invitation/${props.id}`
  }
  function user() {
    return session.data?.user
  }
  // Better Auth accepts only from the invited address, compared case-insensitively.
  function isRecipient() {
    return user()?.email.toLowerCase() === invitation.data?.email.toLowerCase()
  }

  async function refreshSession() {
    await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey })
    await router.invalidate()
  }

  async function accept() {
    const data = invitation.data!
    setError(null)
    setAccepting(true)
    const { error } = await authClient.organization.acceptInvitation({ invitationId: data.id })
    if (error) {
      setAccepting(false)
      setError(errorMessage(error))
      return
    }
    await authClient.organization.setActive({ organizationId: data.organizationId })
    await queryClient.invalidateQueries()
    await navigate({ to: '/timer' })
  }

  // The wrong account signs out and comes back here to sign in with the invited one.
  async function signOut() {
    await authClient.signOut()
    await refreshSession()
  }

  return (
    <AuthLayout>
      <Show when={invitation.data} fallback={<Closed signedIn={!!user()} />}>
        {(data) => (
          <Switch>
            <Match when={data().state === 'closed'}>
              <Closed signedIn={!!user()} />
            </Match>
            <Match when={data().state === 'expired'}>
              <AuthIcon>
                <ClockIcon aria-hidden="true" />
              </AuthIcon>
              <AuthHeading
                title={m.invitation_expired_title()}
                description={m.invitation_expired_description({
                  inviter: data().inviterName,
                  organization: data().organizationName,
                })}
              />
              <Button variant="outline" onClick={() => navigate({ to: '/' })}>
                {user() ? m.auth_continue() : m.auth_go_to_sign_in()}
              </Button>
            </Match>
            <Match when={user() && !isRecipient()}>
              <AuthIcon>
                <CircleAlertIcon aria-hidden="true" />
              </AuthIcon>
              <AuthHeading
                title={m.invitation_wrong_title()}
                description={m.invitation_wrong_description({
                  current: user()!.email,
                  inviter: data().inviterName,
                  email: data().email,
                })}
              />
              <div class="grid gap-2">
                <Button onClick={signOut}>{m.invitation_wrong_switch()}</Button>
                <Button variant="outline" onClick={() => navigate({ to: '/' })}>
                  <span class="truncate">
                    {m.invitation_wrong_continue({ email: user()!.email })}
                  </span>
                </Button>
              </div>
              <p class="text-muted-foreground text-sm">
                {m.invitation_wrong_hint({ inviter: data().inviterName })}
              </p>
            </Match>
            <Match when={true}>
              <div class="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback class="font-medium">
                    {data().organizationName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div class="min-w-0">
                  <p class="truncate font-medium">{data().organizationName}</p>
                  <Show when={data().teamName}>
                    {(team) => (
                      <p class="text-muted-foreground truncate text-sm">
                        {m.invitation_team({ team: team() })}
                      </p>
                    )}
                  </Show>
                </div>
              </div>
              <AuthHeading
                title={m.invitation_title({ organization: data().organizationName })}
                description={m.invitation_description({
                  inviter: data().inviterName,
                  email: data().email,
                  as: AS_ROLE[data().role](),
                })}
              />
              <FormAlert message={error()} />
              <Show
                when={user()}
                fallback={
                  <>
                    <ProviderButtons
                      methods={methods.data ?? []}
                      callbackURL={path()}
                      errorCallbackURL={path()}
                      onError={setError}
                    />
                    <Show when={methods.data?.includes('password')}>
                      <PasswordSignIn
                        email={data().email}
                        submitLabel={m.sign_in_submit()}
                        submittingLabel={m.sign_in_submitting()}
                        onSuccess={refreshSession}
                      />
                    </Show>
                  </>
                }
              >
                <Button onClick={accept} disabled={accepting()}>
                  <Show when={accepting()} fallback={m.invitation_accept()}>
                    <LoaderCircleIcon class="animate-spin" aria-hidden="true" />
                    {m.invitation_accepting()}
                  </Show>
                </Button>
              </Show>
              <p class="text-muted-foreground text-center text-sm">
                {m.auth_not_you()}{' '}
                <Show
                  when={user()}
                  fallback={
                    <Button
                      variant="link"
                      class="h-auto p-0"
                      onClick={() => navigate({ to: '/sign-in' })}
                    >
                      {m.invitation_other_account()}
                    </Button>
                  }
                >
                  <Button variant="link" class="h-auto p-0" onClick={signOut}>
                    {m.auth_sign_out()}
                  </Button>
                </Show>
              </p>
            </Match>
          </Switch>
        )}
      </Show>
    </AuthLayout>
  )
}

function Closed(props: { signedIn: boolean }) {
  const navigate = useNavigate()
  return (
    <>
      <AuthIcon>
        <CircleAlertIcon aria-hidden="true" />
      </AuthIcon>
      <AuthHeading
        title={m.invitation_closed_title()}
        description={m.invitation_closed_description()}
      />
      <Button variant="outline" onClick={() => navigate({ to: '/' })}>
        {props.signedIn ? m.auth_continue() : m.auth_go_to_sign_in()}
      </Button>
    </>
  )
}

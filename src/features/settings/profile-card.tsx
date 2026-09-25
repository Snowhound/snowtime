// The Profile card of the settings page (prototypes/settings.html): the name, saved
// through Better Auth's updateUser, the read-only email, and the sign-in methods.
import { createForm } from '@tanstack/solid-form'
import { useQueryClient } from '@tanstack/solid-query'
import { Show, createSignal } from 'solid-js'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Separator } from '~/components/ui/separator'
import {
  TextField,
  TextFieldDescription,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from '~/components/ui/text-field'
import { authClient } from '~/lib/auth-client'
import { fieldError } from '~/lib/form'
import { sessionQuery } from '~/lib/session'
import { initials } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { AppSession } from '~/server/auth/auth.functions'
import type { SignInMethod } from '~/server/auth/auth.functions'
import { ProfileForm } from '~/server/auth/auth.schemas'
import { SignInMethodsList } from './sign-in-methods-list'

export function ProfileCard(props: {
  user: AppSession['user']
  timeZone: string
  methods: readonly SignInMethod[]
  linkError?: string | null
}) {
  const queryClient = useQueryClient()
  const [status, setStatus] = createSignal<string | null>(null)

  const form = createForm(() => ({
    defaultValues: { name: props.user.name },
    validators: { onSubmit: ProfileForm },
    onSubmitInvalid: () => queueMicrotask(() => document.getElementById('profile-name')?.focus()),
    onSubmit: async ({ value, formApi }) => {
      const name = value.name.trim()
      const { error } = await authClient.updateUser({ name })
      if (error) {
        setStatus(m.error_unexpected())
        return
      }
      // The member lists name the user too, and would otherwise wait out their stale time.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: ['members'] }),
      ])
      formApi.reset({ name })
      setStatus(m.settings_saved())
    },
  }))
  const unchanged = form.useStore((state) => state.values.name.trim() === props.user.name)
  const submitting = form.useStore((state) => state.isSubmitting)

  return (
    <Card role="region" id="profile" class="scroll-mt-6" aria-labelledby="profile-title">
      <CardHeader>
        <CardTitle id="profile-title">{m.settings_profile()}</CardTitle>
        <CardDescription>{m.settings_profile_description()}</CardDescription>
      </CardHeader>
      <form
        class="grid grid-cols-[minmax(0,1fr)] gap-4 p-6 pt-0"
        novalidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <div class="flex min-w-0 items-center gap-4">
          <Avatar class="size-12">
            <Show when={props.user.image}>{(image) => <AvatarImage src={image()} alt="" />}</Show>
            <AvatarFallback class="text-sm font-medium">{initials(props.user.name)}</AvatarFallback>
          </Avatar>
          <div class="min-w-0">
            <p class="truncate font-medium">{props.user.name}</p>
            <p class="text-muted-foreground text-sm">{m.settings_picture_hint()}</p>
          </div>
        </div>
        <div class="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <form.Field name="name">
            {(field) => (
              <TextField
                class="grid content-start gap-2"
                value={field().state.value}
                onChange={(value) => {
                  field().handleChange(value)
                  setStatus(null)
                }}
                validationState={fieldError(field().state.meta.errors) ? 'invalid' : 'valid'}
              >
                <TextFieldLabel>{m.settings_name()}</TextFieldLabel>
                <TextFieldInput
                  id="profile-name"
                  name="name"
                  autocomplete="name"
                  onBlur={field().handleBlur}
                />
                <TextFieldErrorMessage>
                  {fieldError(field().state.meta.errors)}
                </TextFieldErrorMessage>
              </TextField>
            )}
          </form.Field>
          <TextField class="grid content-start gap-2" value={props.user.email} readOnly>
            <TextFieldLabel>{m.sign_in_email()}</TextFieldLabel>
            <TextFieldInput type="email" class="bg-muted/50 text-muted-foreground" />
            <TextFieldDescription class="text-muted-foreground text-xs">
              {m.settings_email_hint()}
            </TextFieldDescription>
          </TextField>
        </div>
        <div class="flex items-center justify-end gap-3">
          <p class="text-muted-foreground text-sm" aria-live="polite">
            {status()}
          </p>
          <Button type="submit" disabled={unchanged() || submitting()}>
            {m.settings_save_profile()}
          </Button>
        </div>
      </form>
      <Separator />
      <CardContent class="grid grid-cols-[minmax(0,1fr)] gap-3 pt-6" id="sign-in-methods">
        <div>
          <h4 class="text-sm font-medium">{m.settings_sign_in_methods()}</h4>
          <p class="text-muted-foreground text-sm">{m.settings_sign_in_methods_description()}</p>
        </div>
        <SignInMethodsList
          methods={props.methods}
          timeZone={props.timeZone}
          linkError={props.linkError}
        />
      </CardContent>
    </Card>
  )
}

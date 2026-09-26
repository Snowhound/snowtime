import { createForm } from '@tanstack/solid-form'
import { useQueryClient } from '@tanstack/solid-query'
import { useNavigate } from '@tanstack/solid-router'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import MailIcon from 'lucide-solid/icons/mail'
import { Show, createSignal } from 'solid-js'
import { AuthHeading, AuthLayout } from '~/components/auth-layout/auth-layout'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import {
  TextField,
  TextFieldDescription,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from '~/components/ui/text-field'
import { authClient, signOut } from '~/lib/auth-client'
import { errorMessage } from '~/lib/errors'
import { fieldError } from '~/lib/form'
import { sessionQuery } from '~/lib/session'
import { m } from '~/paraglide/messages.js'
import { CreateOrganizationForm, slugify } from '~/server/auth/auth.schemas'
import { FormAlert } from './sign-in-methods'

export function CreateOrganizationPage(props: { email: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [formError, setFormError] = createSignal<string | null>(null)
  // The short name follows the name until the user edits it.
  const [slugEdited, setSlugEdited] = createSignal(false)
  let formRef!: HTMLFormElement

  function focusInvalid() {
    queueMicrotask(() =>
      formRef.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus(),
    )
  }

  const form = createForm(() => ({
    defaultValues: { name: '', slug: '' },
    validators: { onSubmit: CreateOrganizationForm },
    onSubmitInvalid: focusInvalid,
    onSubmit: async ({ value, formApi }) => {
      setFormError(null)
      const name = value.name.trim()
      const taken = await authClient.organization.checkSlug({ slug: value.slug })
      if (taken.error) {
        formApi.setFieldMeta('slug', (meta) => ({
          ...meta,
          errorMap: { ...meta.errorMap, onSubmit: m.validation_slug_taken() },
        }))
        focusInvalid()
        return
      }
      // Better Auth makes the new organization the session's active one.
      const { error } = await authClient.organization.create({ name, slug: value.slug })
      if (error) {
        setFormError(errorMessage(error))
        return
      }
      await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey })
      await navigate({ to: '/timer' })
    },
  }))
  const submitting = form.useStore((state) => state.isSubmitting)

  return (
    <AuthLayout>
      <AuthHeading title={m.create_org_title()} description={m.create_org_description()} />
      <form
        ref={formRef}
        class="grid gap-4"
        novalidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <FormAlert message={formError()} />
        <form.Field name="name">
          {(field) => (
            <TextField
              class="grid gap-2"
              value={field().state.value}
              onChange={(name) => {
                field().handleChange(name)
                if (!slugEdited()) form.setFieldValue('slug', slugify(name))
              }}
              validationState={fieldError(field().state.meta.errors) ? 'invalid' : 'valid'}
            >
              <TextFieldLabel>{m.create_org_name()}</TextFieldLabel>
              <TextFieldInput name="name" autocomplete="organization" onBlur={field().handleBlur} />
              <TextFieldErrorMessage>{fieldError(field().state.meta.errors)}</TextFieldErrorMessage>
            </TextField>
          )}
        </form.Field>
        <form.Field name="slug">
          {(field) => (
            <TextField
              class="grid gap-2"
              value={field().state.value}
              onChange={(slug) => {
                setSlugEdited(true)
                field().handleChange(slug)
              }}
              validationState={fieldError(field().state.meta.errors) ? 'invalid' : 'valid'}
            >
              <TextFieldLabel>{m.create_org_slug()}</TextFieldLabel>
              <TextFieldInput name="slug" autocomplete="off" onBlur={field().handleBlur} />
              <TextFieldDescription>{m.create_org_slug_hint()}</TextFieldDescription>
              <TextFieldErrorMessage>{fieldError(field().state.meta.errors)}</TextFieldErrorMessage>
            </TextField>
          )}
        </form.Field>
        <Button type="submit" disabled={submitting()}>
          <Show when={submitting()} fallback={m.create_org_submit()}>
            <LoaderCircleIcon class="animate-spin" aria-hidden="true" />
            {m.create_org_submitting()}
          </Show>
        </Button>
      </form>
      <Alert>
        <MailIcon aria-hidden="true" />
        <AlertTitle>{m.create_org_join_title()}</AlertTitle>
        <AlertDescription>{m.create_org_join_description({ email: props.email })}</AlertDescription>
      </Alert>
      <p class="text-muted-foreground text-center text-sm">
        {m.auth_not_you()}{' '}
        <Button variant="link" class="h-auto p-0" onClick={signOut}>
          {m.auth_sign_out()}
        </Button>
      </p>
    </AuthLayout>
  )
}

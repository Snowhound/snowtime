// The General tab: the organization's name, its short name, which can't change, and a
// note that organizations can't be deleted (disableOrganizationDeletion in
// better-auth.server.ts).
import { createForm } from '@tanstack/solid-form'
import InfoIcon from 'lucide-solid/icons/info'
import { createSignal } from 'solid-js'
import * as v from 'valibot'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '~/components/ui/card'
import {
  TextField,
  TextFieldDescription,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from '~/components/ui/text-field'
import { fieldError } from '~/lib/form'
import { m } from '~/paraglide/messages.js'
import { Name } from '~/server/auth/auth.schemas'

export function GeneralTab(props: {
  name: string
  slug: string
  onRename: (name: string, done: () => void) => void
}) {
  const [status, setStatus] = createSignal<string | null>(null)

  const form = createForm(() => ({
    defaultValues: { name: props.name },
    onSubmitInvalid: () => queueMicrotask(() => document.getElementById('org-name')?.focus()),
    onSubmit: ({ value, formApi }) => {
      const name = value.name.trim()
      formApi.reset({ name })
      props.onRename(name, () => setStatus(m.organization_saved()))
    },
  }))
  const unchanged = form.useStore((state) => state.values.name.trim() === props.name)

  return (
    <Card class="max-w-2xl">
      <form
        novalidate
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <CardHeader>
          <h2 class="text-lg leading-none font-semibold tracking-tight">
            {m.organization_general()}
          </h2>
          <CardDescription>{m.organization_general_description()}</CardDescription>
        </CardHeader>
        <CardContent class="grid grid-cols-[minmax(0,1fr)] gap-4">
          <form.Field
            name="name"
            validators={{
              onSubmit: ({ value }) => {
                const result = v.safeParse(Name, value)
                return result.success ? undefined : result.issues[0].message
              },
            }}
          >
            {(field) => (
              <TextField
                class="grid gap-2"
                value={field().state.value}
                onChange={(value) => {
                  setStatus(null)
                  field().handleChange(value)
                }}
                validationState={fieldError(field().state.meta.errors) ? 'invalid' : 'valid'}
              >
                <TextFieldLabel>{m.organization_name()}</TextFieldLabel>
                <TextFieldInput
                  id="org-name"
                  autocomplete="organization"
                  maxLength={100}
                  onBlur={field().handleBlur}
                />
                <TextFieldErrorMessage>
                  {fieldError(field().state.meta.errors)}
                </TextFieldErrorMessage>
              </TextField>
            )}
          </form.Field>
          <TextField class="grid gap-2" value={props.slug} readOnly>
            <TextFieldLabel>{m.organization_slug()}</TextFieldLabel>
            <TextFieldInput class="bg-muted/50 text-muted-foreground" />
            <TextFieldDescription class="text-xs">
              {m.organization_slug_hint()}
            </TextFieldDescription>
          </TextField>
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertDescription>{m.organization_no_delete()}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter class="justify-end gap-3">
          <p class="text-muted-foreground text-sm" aria-live="polite">
            {status()}
          </p>
          <Button type="submit" disabled={unchanged()}>
            {m.organization_save()}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

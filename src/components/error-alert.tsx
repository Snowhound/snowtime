import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import { Show } from 'solid-js'
import { Alert, AlertDescription } from '~/components/ui/alert'

// An error above a form or a page's content, such as wrong credentials or a failed save.
export function ErrorAlert(props: { message: string | null | undefined }) {
  return (
    <Show when={props.message}>
      <Alert variant="destructive">
        <CircleAlertIcon aria-hidden="true" />
        <AlertDescription>{props.message}</AlertDescription>
      </Alert>
    </Show>
  )
}

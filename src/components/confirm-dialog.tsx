// Asks before a destructive action, such as archiving a project or removing a member, or
// only explains, such as why a delete was refused.
import { Show, createMemo } from 'solid-js'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { m } from '~/paraglide/messages.js'

export interface Confirmation {
  title: string
  description: string
  // The button that closes without acting; Cancel by default.
  cancel?: string
  // Without an action the dialog only explains, with an OK button.
  action?: { label: string; destructive?: boolean; run: () => void }
}

export function ConfirmDialog(props: { confirmation: Confirmation | null; onClose: () => void }) {
  // The last confirmation stays while the dialog animates closed.
  const shown = createMemo<Confirmation | null>((last) => props.confirmation ?? last, null)
  return (
    <Dialog open={props.confirmation !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent class="grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle class="break-words">{shown()?.title}</DialogTitle>
          <DialogDescription class="break-words">{shown()?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => props.onClose()}>
            {shown()?.action ? (shown()?.cancel ?? m.confirm_cancel()) : m.confirm_ok()}
          </Button>
          <Show when={shown()?.action}>
            {(action) => (
              <Button
                variant={action().destructive ? 'destructive' : 'default'}
                onClick={() => {
                  // Closed first: the action may open the next confirmation.
                  props.onClose()
                  action().run()
                }}
              >
                {action().label}
              </Button>
            )}
          </Show>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

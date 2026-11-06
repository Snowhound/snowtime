// A menu opened at a point on the week grid: at
// the pointer for a right-click or a long press, or under an entry from the keyboard. It is a
// DropdownMenu anchored to the point; the grid opens it, so its trigger is hidden. It opens
// when it mounts and runs the picked item once it has closed: an item that opens the entry
// popover would otherwise have the closing menu's focus land outside the popover, which
// closes it again. Focus goes where the item or `onClosed` puts it.
import { For, type JSX, Show, createSignal } from 'solid-js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { cn } from '~/lib/utils'

interface MenuAction {
  label: JSX.Element
  icon: JSX.Element
  shortcut?: string
  disabled?: boolean
  destructive?: boolean
  onSelect: () => void
}

export type MenuItem = MenuAction | 'separator'

function mac() {
  return /Mac|iPhone|iPad/.test(navigator.platform)
}

// ⌘C on a Mac, Ctrl+C elsewhere: the keys that copy a focused entry.
export function copyKeys() {
  return mac() ? '⌘C' : 'Ctrl+C'
}

// The keys that paste the copied entry under the pointer.
export function pasteKeys() {
  return mac() ? '⌘V' : 'Ctrl+V'
}

// Whether the event is the platform's shortcut with the letter, such as copy's C.
export function isShortcut(event: KeyboardEvent, letter: 'c' | 'v') {
  return (
    (mac() ? event.metaKey : event.ctrlKey) && !event.altKey && event.key.toLowerCase() === letter
  )
}

export function PointMenu(props: {
  at: { x: number; y: number }
  label: string
  // A title over the items, such as the day and time of empty time.
  title?: string
  items: readonly MenuItem[]
  hint?: string
  class?: string
  // After it has closed, and after the picked item ran.
  onClosed: () => void
}) {
  const [open, setOpen] = createSignal(true)
  let picked: (() => void) | undefined
  return (
    <DropdownMenu
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-start"
      gutter={2}
      getAnchorRect={() => ({ x: props.at.x, y: props.at.y, width: 0, height: 0 })}
    >
      {/* The content takes its name from the trigger. */}
      <DropdownMenuTrigger class="hidden" tabIndex={-1} aria-hidden="true">
        {props.label}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        class={props.class}
        onCloseAutoFocus={(event: Event) => {
          event.preventDefault()
          const run = picked
          picked = undefined
          run?.()
          props.onClosed()
        }}
      >
        <Show when={props.title}>
          <div class="px-2 py-1.5 text-sm font-medium tabular-nums" aria-hidden="true">
            {props.title}
          </div>
        </Show>
        <For each={props.items}>
          {(item) =>
            item === 'separator' ? (
              <DropdownMenuSeparator />
            ) : (
              <DropdownMenuItem
                class={cn(
                  '[&_svg]:size-4 [&_svg]:shrink-0',
                  item.destructive && 'text-destructive focus:text-destructive',
                )}
                disabled={item.disabled}
                onSelect={() => (picked = item.onSelect)}
              >
                {item.icon}
                <span class="min-w-0 truncate">{item.label}</span>
                <Show when={item.shortcut}>
                  <DropdownMenuShortcut class="pl-3">{item.shortcut}</DropdownMenuShortcut>
                </Show>
              </DropdownMenuItem>
            )
          }
        </For>
        <Show when={props.hint}>
          <p class="text-muted-foreground px-2 pt-1 pb-1.5 text-xs">{props.hint}</p>
        </Show>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

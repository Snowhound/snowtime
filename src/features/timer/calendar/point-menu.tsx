// A menu opened at a point on the week grid (prototypes/copy-entries.html, "Context menus"): at
// the pointer for a right-click or a long press, or under an entry from the keyboard. It is a
// DropdownMenu anchored to the point; the grid opens it, so its trigger is hidden. Focus goes
// where `onClosed` puts it.
import { For, type JSX, Show } from 'solid-js'
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

// ⌘C on a Mac, Ctrl+C elsewhere: the keys that copy a focused entry.
export function copyKeys() {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘C' : 'Ctrl+C'
}

// Whether the event is the platform's copy shortcut.
export function isCopyKey(event: KeyboardEvent) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)
  return (mac ? event.metaKey : event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'c'
}

export function PointMenu(props: {
  at: { x: number; y: number } | null
  label: string
  // A title over the items, such as the day and time of empty time.
  title?: string
  items: readonly MenuItem[]
  hint?: string
  class?: string
  onClose: () => void
  onClosed?: () => void
}) {
  return (
    <DropdownMenu
      open={props.at !== null}
      onOpenChange={(open) => !open && props.onClose()}
      placement="bottom-start"
      gutter={2}
      getAnchorRect={() => {
        const at = props.at
        return at ? { x: at.x, y: at.y, width: 0, height: 0 } : undefined
      }}
    >
      {/* The content takes its name from the trigger. */}
      <DropdownMenuTrigger class="hidden" tabIndex={-1} aria-hidden="true">
        {props.label}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        class={props.class}
        onCloseAutoFocus={(event: Event) => {
          event.preventDefault()
          props.onClosed?.()
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
                onSelect={() => item.onSelect()}
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

// The app icon picker (prototypes/app-frame.js, "App icon picker"): two radio groups in a modal
// dialog, one per favicon tile. Each option shows the bare mark for the page's theme, with the
// tiled favicon as a badge. Hound Hour has both tiles but is listed once, with the navy ones. A
// choice saves right away, like the other settings.
import CheckIcon from 'lucide-solid/icons/check'
import { For, Show } from 'solid-js'
import { AppMark } from '~/components/app-mark'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { APP_ICONS, type AppIconId, DEFAULT_APP_ICON, appTabIconSrc } from '~/lib/app-icon'
import { m } from '~/paraglide/messages.js'

const GROUPS = [
  {
    id: 'light',
    label: m.app_icon_light_tabs,
    icons: APP_ICONS.filter((icon) => icon.tile === 'ice'),
  },
  {
    id: 'navy',
    label: m.app_icon_navy_tabs,
    icons: APP_ICONS.filter((icon) => icon.tile === 'navy'),
  },
]

export function AppIconDialog(props: {
  open: boolean
  value: AppIconId
  onChange: (id: AppIconId) => void
  onClose: () => void
}) {
  let content: HTMLDivElement | undefined
  // The control that opened the dialog. The dialog is controlled rather than opened by a
  // DialogTrigger, so Kobalte doesn't know it and focus comes back here by hand.
  let opener: HTMLElement | null = null

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        ref={content}
        class="max-w-3xl grid-cols-[minmax(0,1fr)]"
        // Focus starts on the chosen option and returns to the opener on close.
        onOpenAutoFocus={(event: Event) => {
          event.preventDefault()
          opener = document.activeElement as HTMLElement | null
          content?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
        }}
        onCloseAutoFocus={(event: Event) => {
          if (!opener?.isConnected) return
          event.preventDefault()
          opener.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{m.settings_app_icon()}</DialogTitle>
          <DialogDescription>{m.app_icon_description()}</DialogDescription>
        </DialogHeader>
        <For each={GROUPS}>
          {(group) => (
            <IconGroup
              id={group.id}
              label={group.label()}
              icons={group.icons}
              value={props.value}
              onChange={props.onChange}
            />
          )}
        </For>
        <DialogFooter>
          <Button onClick={() => props.onClose()}>{m.app_icon_done()}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// One radio group, with one option in the tab order: the chosen one, or the group's first.
// Arrow keys move through the grid and choose; Home and End jump.
function IconGroup(props: {
  id: string
  label: string
  icons: typeof APP_ICONS
  value: AppIconId
  onChange: (id: AppIconId) => void
}) {
  let grid: HTMLDivElement | undefined

  function tabbable(id: AppIconId) {
    return props.icons.some((icon) => icon.id === props.value)
      ? id === props.value
      : id === props.icons[0].id
  }

  function choose(option: HTMLButtonElement) {
    option.focus()
    const id = option.dataset.appIcon as AppIconId
    if (id !== props.value) props.onChange(id)
  }

  function onKeyDown(event: KeyboardEvent) {
    const options = [...grid!.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    const i = options.indexOf(event.target as HTMLButtonElement)
    if (i < 0) return
    const columns = options.filter((o) => o.offsetTop === options[0].offsetTop).length
    const moves: Record<string, number> = {
      ArrowLeft: i - 1,
      ArrowRight: i + 1,
      ArrowUp: i - columns,
      ArrowDown: i + columns,
      Home: 0,
      End: options.length - 1,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    choose(options[(next + options.length) % options.length])
  }

  return (
    <div class="grid gap-2">
      <h3 id={`app-icon-group-${props.id}`} class="text-sm font-medium">
        {props.label}
      </h3>
      <div
        ref={grid}
        role="radiogroup"
        aria-labelledby={`app-icon-group-${props.id}`}
        class="grid grid-cols-3 gap-1 sm:grid-cols-6 sm:gap-2"
        onKeyDown={onKeyDown}
      >
        <For each={props.icons}>
          {(icon) => (
            <button
              type="button"
              role="radio"
              data-app-icon={icon.id}
              aria-checked={icon.id === props.value}
              tabIndex={tabbable(icon.id) ? 0 : -1}
              class="group hover:bg-accent focus-visible:ring-ring aria-checked:border-primary aria-checked:bg-accent relative flex flex-col items-center gap-1.5 rounded-lg border border-transparent px-1 py-2 text-center text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none sm:gap-2 sm:p-3 sm:text-sm"
              onClick={(event) => choose(event.currentTarget)}
            >
              <span class="bg-primary text-primary-foreground absolute top-1 right-1 hidden size-5 items-center justify-center rounded-full group-aria-checked:flex">
                <CheckIcon class="size-3" aria-hidden="true" />
              </span>
              <span class="relative">
                <AppMark id={icon.id} class="size-11 sm:size-14" />
                <img
                  src={appTabIconSrc(icon.id)}
                  alt=""
                  title={m.app_icon_tab_icon()}
                  class="ring-border absolute -right-2 -bottom-1 size-5 rounded-[22.5%] shadow-sm ring-1"
                />
              </span>
              <span class="flex flex-col leading-tight">
                <span class="text-muted-foreground text-xs tabular-nums">{icon.id}</span>
                <span class="font-medium">{icon.name}</span>
              </span>
              <Show when={icon.id === DEFAULT_APP_ICON}>
                <Badge variant="secondary" class="px-1.5 py-0 text-[10px]">
                  {m.app_icon_default()}
                </Badge>
              </Show>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

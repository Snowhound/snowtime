// The header's Appearance popover (prototypes/app-frame.js), from the mountain button left of the
// avatar on every page: the theme, the app icon with Change, and the scenery, compact, with
// hints only where the label doesn't say enough, so it fits a 390 × 844 screen. Each change
// saves right away through useUpdateSettings.
import { Link } from '@tanstack/solid-router'
import MonitorIcon from 'lucide-solid/icons/monitor'
import MoonIcon from 'lucide-solid/icons/moon'
import MountainSnowIcon from 'lucide-solid/icons/mountain-snow'
import SunIcon from 'lucide-solid/icons/sun'
import { For, createSignal } from 'solid-js'
import { AppIconDialog } from '~/components/app-icon-dialog'
import { AppMark } from '~/components/app-mark'
import { SceneryFields } from '~/components/scenery-fields'
import { Button, buttonVariants } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Separator } from '~/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { appIcon } from '~/lib/app-icon'
import { type Settings, useUpdateSettings } from '~/lib/settings'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

const THEMES = [
  { value: 'light', label: m.theme_light, Icon: SunIcon },
  { value: 'dark', label: m.theme_dark, Icon: MoonIcon },
  { value: 'system', label: m.theme_system, Icon: MonitorIcon },
] as const

export function AppearancePopover(props: { settings: Settings }) {
  const save = useUpdateSettings()
  const [open, setOpen] = createSignal(false)
  const [iconDialogOpen, setIconDialogOpen] = createSignal(false)
  let trigger: HTMLButtonElement | undefined

  function icon() {
    return appIcon(props.settings.appIcon)
  }

  // The popover closes behind the dialog, so the dialog opens from the Appearance button and
  // returns focus there.
  function changeIcon() {
    setOpen(false)
    trigger?.focus()
    setIconDialogOpen(true)
  }

  return (
    <>
      <Popover placement="bottom-end" open={open()} onOpenChange={setOpen}>
        <PopoverTrigger
          as={Button<'button'>}
          ref={trigger}
          variant="ghost"
          size="icon"
          class="ml-auto size-9 shrink-0"
          aria-label={m.settings_appearance()}
          title={m.settings_appearance()}
        >
          <MountainSnowIcon aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent
          class="grid w-80 gap-3"
          aria-labelledby="appearance-title"
          // Kobalte's toggle groups take Escape to clear their selection and block the popover's
          // dismiss, so the popover closes here, which runs first.
          onEscapeKeyDown={() => setOpen(false)}
        >
          <h2 id="appearance-title" class="text-sm font-semibold">
            {m.settings_appearance()}
          </h2>
          <div class="mb-2 grid gap-1.5">
            <span class="text-sm leading-none font-medium" id="appearance-theme-label">
              {m.user_menu_theme()}
            </span>
            <ToggleGroup
              variant="outline"
              size="sm"
              class="grid grid-cols-3"
              aria-labelledby="appearance-theme-label"
              value={props.settings.theme}
              onChange={(value) => value && save.mutate({ theme: value as Settings['theme'] })}
            >
              <For each={THEMES}>
                {(theme) => (
                  <ToggleGroupItem value={theme.value} class="h-8 gap-1.5">
                    <theme.Icon class="size-4" aria-hidden="true" />
                    {theme.label()}
                  </ToggleGroupItem>
                )}
              </For>
            </ToggleGroup>
          </div>
          <div class="mb-2 flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2.5">
              <AppMark id={icon().id} class="size-8" />
              <div class="grid min-w-0 gap-0.5">
                <span class="text-sm leading-none font-medium" id="appearance-icon-label">
                  {m.settings_app_icon()}
                </span>
                <span class="text-muted-foreground truncate text-xs">{icon().name}</span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              class="h-8"
              aria-describedby="appearance-icon-label"
              aria-haspopup="dialog"
              onClick={changeIcon}
            >
              {m.settings_app_icon_change()}
            </Button>
          </div>
          <Separator />
          <h3 class="text-muted-foreground text-xs font-medium">{m.scene_title()}</h3>
          <SceneryFields
            settings={props.settings}
            hints="none"
            onChange={(patch) => save.mutate(patch)}
          />
          <Separator />
          <Link
            to="/settings"
            hash="preferences"
            class={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'h-auto justify-start p-0')}
            onClick={() => setOpen(false)}
          >
            {m.appearance_all_settings()}
          </Link>
        </PopoverContent>
      </Popover>
      <AppIconDialog
        open={iconDialogOpen()}
        value={icon().id}
        onChange={(id) => save.mutate({ appIcon: id })}
        onClose={() => setIconDialogOpen(false)}
      />
    </>
  )
}

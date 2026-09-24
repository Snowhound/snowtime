// The timer's View popover (prototypes/timer.html): the layout, the theme, and whether
// the summary shows. They are user settings, saved through useUpdateSettings, so they
// change at once here, on the settings page, and in the user menu.
import { Link } from '@tanstack/solid-router'
import SettingsIcon from 'lucide-solid/icons/settings'
import { For } from 'solid-js'
import { Button, buttonVariants } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Separator } from '~/components/ui/separator'
import { Switch, SwitchControl, SwitchLabel, SwitchThumb } from '~/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { type Settings, useUpdateSettings } from '~/lib/settings'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { UpdateSettingsInput } from '~/server/settings/settings.schemas'

const LAYOUTS = [
  { value: 'bar', label: m.settings_layout_bar },
  { value: 'focus', label: m.settings_layout_focus },
  { value: 'table', label: m.settings_layout_table },
] as const

const THEMES = [
  { value: 'light', label: m.theme_light },
  { value: 'dark', label: m.theme_dark },
  { value: 'system', label: m.theme_system },
] as const

export function ViewPopover(props: { settings: Settings; onError: (error: unknown) => void }) {
  const save = useUpdateSettings()

  function update(patch: UpdateSettingsInput) {
    save.mutate(patch, { onError: props.onError })
  }

  return (
    <Popover placement="bottom-end">
      <PopoverTrigger
        as={Button<'button'>}
        variant="outline"
        size="icon"
        class="size-9"
        aria-label={m.timer_view_settings()}
      >
        <SettingsIcon aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent class="grid gap-4" aria-labelledby="view-settings-title">
        <h2 id="view-settings-title" class="leading-none font-medium">
          {m.timer_view()}
        </h2>
        <div class="grid gap-2">
          <span class="text-sm leading-none font-medium" id="view-layout-label">
            {m.timer_view_layout()}
          </span>
          <ToggleGroup
            variant="outline"
            size="sm"
            class="justify-start"
            aria-labelledby="view-layout-label"
            value={props.settings.timerLayout}
            onChange={(value) => value && update({ timerLayout: value as Settings['timerLayout'] })}
          >
            <For each={LAYOUTS}>
              {(option) => <ToggleGroupItem value={option.value}>{option.label()}</ToggleGroupItem>}
            </For>
          </ToggleGroup>
        </div>
        <div class="grid gap-2">
          <span class="text-sm leading-none font-medium" id="view-theme-label">
            {m.user_menu_theme()}
          </span>
          <ToggleGroup
            variant="outline"
            size="sm"
            class="justify-start"
            aria-labelledby="view-theme-label"
            value={props.settings.theme}
            onChange={(value) => value && update({ theme: value as Settings['theme'] })}
          >
            <For each={THEMES}>
              {(option) => <ToggleGroupItem value={option.value}>{option.label()}</ToggleGroupItem>}
            </For>
          </ToggleGroup>
        </div>
        <Switch
          class="flex items-center justify-between gap-4"
          checked={props.settings.showSummary}
          onChange={(showSummary) => update({ showSummary })}
        >
          <SwitchLabel>{m.settings_show_summary()}</SwitchLabel>
          <SwitchControl>
            <SwitchThumb />
          </SwitchControl>
        </Switch>
        <Separator />
        <Link
          to="/settings"
          hash="preferences"
          class={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'h-auto justify-start p-0')}
        >
          {m.timer_view_all_settings()}
        </Link>
      </PopoverContent>
    </Popover>
  )
}

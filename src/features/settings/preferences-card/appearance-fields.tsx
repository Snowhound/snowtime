// The appearance section of the Preferences card: app icon, theme, timer layout, and the
// display switches.
import { createSignal, onMount } from 'solid-js'
import { AppIconDialog } from '~/components/app-icon-dialog'
import { AppMark } from '~/components/app-mark'
import { Button } from '~/components/ui/button'
import {
  Switch,
  SwitchControl,
  SwitchDescription,
  SwitchLabel,
  SwitchThumb,
} from '~/components/ui/switch'
import { appIcon } from '~/lib/app-icon'
import type { Settings } from '~/lib/queries/settings'
import { expectThemeSwitch } from '~/lib/scene/scene'
import { m } from '~/paraglide/messages.js'
import type { UpdateSettingsInput } from '~/server/settings/settings.schemas'
import { Choice } from './choice'

const THEMES = [
  { value: 'light', label: m.theme_light },
  { value: 'dark', label: m.theme_dark },
  { value: 'system', label: m.theme_system },
] as const

const LAYOUTS = [
  { value: 'bar', label: m.settings_layout_bar },
  { value: 'focus', label: m.settings_layout_focus },
  { value: 'table', label: m.settings_layout_table },
] as const

export function AppearanceFields(props: {
  settings: Settings
  onChange: (patch: UpdateSettingsInput) => void
}) {
  onMount(expectThemeSwitch)

  const [iconDialogOpen, setIconDialogOpen] = createSignal(false)
  function icon() {
    return appIcon(props.settings.appIcon)
  }

  return (
    <div class="grid gap-5">
      <h4 class="text-sm font-medium">{m.settings_appearance()}</h4>
      <div class="flex items-center justify-between gap-4">
        <div class="flex min-w-0 items-center gap-3">
          <AppMark id={icon().id} class="size-10" />
          <div class="grid gap-1">
            <span class="text-sm leading-none font-medium">{m.settings_app_icon()}</span>
            <span class="text-muted-foreground text-sm">
              {icon().id} {icon().name}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-label={m.settings_app_icon_change_label()}
          aria-haspopup="dialog"
          onClick={() => setIconDialogOpen(true)}
        >
          {m.settings_app_icon_change()}
        </Button>
        <AppIconDialog
          open={iconDialogOpen()}
          value={icon().id}
          onChange={(id) => props.onChange({ appIcon: id })}
          onClose={() => setIconDialogOpen(false)}
        />
      </div>
      <div class="grid items-start gap-x-6 gap-y-5 @2xl:grid-cols-2">
        <Choice
          id="theme"
          label={m.user_menu_theme()}
          options={THEMES}
          value={props.settings.theme}
          onChange={(theme) => props.onChange({ theme })}
        />
        <Choice
          id="layout"
          label={m.settings_timer_layout()}
          options={LAYOUTS}
          value={props.settings.timerLayout}
          onChange={(timerLayout) => props.onChange({ timerLayout })}
        />
      </div>
      <Switch
        class="flex items-center justify-between gap-4"
        checked={props.settings.compactRows}
        onChange={(compactRows) => props.onChange({ compactRows })}
      >
        <div class="grid gap-1">
          <SwitchLabel>{m.settings_compact_rows()}</SwitchLabel>
          <SwitchDescription class="text-muted-foreground text-sm">
            {m.settings_compact_rows_description()}
          </SwitchDescription>
        </div>
        <SwitchControl>
          <SwitchThumb />
        </SwitchControl>
      </Switch>
      <Switch
        class="flex items-center justify-between gap-4"
        checked={props.settings.wideTimer}
        onChange={(wideTimer) => props.onChange({ wideTimer })}
      >
        <div class="grid gap-1">
          <SwitchLabel>{m.settings_wide_timer()}</SwitchLabel>
          <SwitchDescription class="text-muted-foreground text-sm">
            {m.settings_wide_timer_description()}
          </SwitchDescription>
        </div>
        <SwitchControl>
          <SwitchThumb />
        </SwitchControl>
      </Switch>
      <Switch
        class="flex items-center justify-between gap-4"
        checked={props.settings.showSummary}
        onChange={(showSummary) => props.onChange({ showSummary })}
      >
        <div class="grid gap-1">
          <SwitchLabel>{m.settings_show_summary()}</SwitchLabel>
          <SwitchDescription class="text-muted-foreground text-sm">
            {m.settings_show_summary_description()}
          </SwitchDescription>
        </div>
        <SwitchControl>
          <SwitchThumb />
        </SwitchControl>
      </Switch>
    </div>
  )
}

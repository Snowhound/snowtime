// The Appearance menus' theme toggles (prototypes/app-frame.js): light, dark, and system with
// their icons, three equal columns.
import MonitorIcon from 'lucide-solid/icons/monitor'
import MoonIcon from 'lucide-solid/icons/moon'
import SunIcon from 'lucide-solid/icons/sun'
import { For, createUniqueId } from 'solid-js'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { m } from '~/paraglide/messages.js'
import type { THEMES } from '~/server/settings/settings.schemas'

type Theme = (typeof THEMES)[number]

const OPTIONS = [
  { value: 'light', label: m.theme_light, Icon: SunIcon },
  { value: 'dark', label: m.theme_dark, Icon: MoonIcon },
  { value: 'system', label: m.theme_system, Icon: MonitorIcon },
] as const

export function ThemeToggle(props: { value: Theme; onChange: (theme: Theme) => void }) {
  const id = createUniqueId()
  return (
    <div class="mb-2 grid gap-1.5">
      <span class="text-sm leading-none font-medium" id={`${id}-theme`}>
        {m.user_menu_theme()}
      </span>
      <ToggleGroup
        variant="outline"
        size="sm"
        class="grid grid-cols-3"
        aria-labelledby={`${id}-theme`}
        value={props.value}
        onChange={(value) => value && props.onChange(value as Theme)}
      >
        <For each={OPTIONS}>
          {(option) => (
            <ToggleGroupItem value={option.value} class="h-8 gap-1.5">
              <option.Icon class="size-4" aria-hidden="true" />
              {option.label()}
            </ToggleGroupItem>
          )}
        </For>
      </ToggleGroup>
    </div>
  )
}

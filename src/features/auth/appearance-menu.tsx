// The signed-out pages' Appearance menu (prototypes/auth.html, "Scenery menu"), from the
// mountain button at the top right: the theme and the scenery with short hints and the Intro
// switch. Signed out it saves on this device; on a signed-in page without an organization yet it
// saves to the account, like the header's popover.
import MountainSnowIcon from 'lucide-solid/icons/mountain-snow'
import { Show, createSignal } from 'solid-js'
import { SceneryFields } from '~/components/scenery-fields'
import { ThemeToggle } from '~/components/theme-toggle'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Separator } from '~/components/ui/separator'
import type { DeviceSettings } from '~/lib/device-settings'
import { m } from '~/paraglide/messages.js'

export function AppearanceMenu(props: {
  settings: DeviceSettings
  onDevice: boolean
  onChange: (patch: Partial<DeviceSettings>) => void
}) {
  const [open, setOpen] = createSignal(false)
  return (
    <Popover placement="bottom-end" open={open()} onOpenChange={setOpen}>
      <PopoverTrigger
        as={Button<'button'>}
        variant="ghost"
        size="icon"
        class="bg-background/50 absolute top-3 right-3 size-9 backdrop-blur"
        aria-label={m.settings_appearance()}
        title={m.settings_appearance()}
      >
        <MountainSnowIcon aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        class="grid w-80 gap-4"
        aria-labelledby="auth-appearance-title"
        // Kobalte's toggle groups take Escape to clear their selection and block the popover's
        // dismiss, so the popover closes here, which runs first.
        onEscapeKeyDown={() => setOpen(false)}
      >
        <div class="grid gap-1">
          <h2 id="auth-appearance-title" class="text-sm font-semibold">
            {m.settings_appearance()}
          </h2>
          <Show when={props.onDevice}>
            <p class="text-muted-foreground text-xs">{m.scene_device_note()}</p>
          </Show>
        </div>
        <ThemeToggle value={props.settings.theme} onChange={(theme) => props.onChange({ theme })} />
        <Separator />
        <h3 class="text-muted-foreground -mb-1 text-xs font-medium">{m.scene_title()}</h3>
        <SceneryFields settings={props.settings} hints="short" intro onChange={props.onChange} />
      </PopoverContent>
    </Popover>
  )
}

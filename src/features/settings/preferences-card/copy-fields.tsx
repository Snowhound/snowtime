// The Copying durations section of the Preferences card: how a duration copies, and the
// pattern its text takes (docs/architecture/timer.md, "Copying durations").
import type { Settings } from '~/lib/queries/settings'
import { m } from '~/paraglide/messages.js'
import type { UpdateSettingsInput } from '~/server/settings/settings.schemas'
import { Choice } from './choice'
import { CopyPatternField } from './copy-pattern-field'

const CONTROLS = [
  { value: 'text', label: m.settings_copy_duration_control_text },
  { value: 'button', label: m.settings_copy_duration_control_button },
] as const

export function CopyFields(props: {
  settings: Settings
  onChange: (patch: UpdateSettingsInput) => void
}) {
  return (
    <div id="copying" class="grid scroll-mt-6 gap-5">
      <div class="grid gap-1">
        <h4 class="text-sm font-medium">{m.settings_copying()}</h4>
        <p class="text-muted-foreground text-sm">{m.settings_copying_description()}</p>
      </div>
      <div class="grid items-start gap-x-6 gap-y-5 @2xl:grid-cols-2">
        <Choice
          id="copy-duration-control"
          label={m.settings_copy_duration_control()}
          options={CONTROLS}
          value={props.settings.copyDurationControl}
          onChange={(copyDurationControl) => props.onChange({ copyDurationControl })}
        />
        <CopyPatternField value={props.settings.copyDurationPattern} onChange={props.onChange} />
      </div>
    </div>
  )
}

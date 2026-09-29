// The Preferences card of the settings page (prototypes/settings.html): language and
// region, appearance with the app icon, and the scenery. Each field saves on change as a
// one-field updateSettings patch.
import CheckIcon from 'lucide-solid/icons/check'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import { Show, createSignal, onCleanup } from 'solid-js'
import { SceneryFields } from '~/components/scene/scenery-fields'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Separator } from '~/components/ui/separator'
import { errorMessage } from '~/lib/errors'
import { type Settings, useUpdateSettings } from '~/lib/queries/settings'
import { playIntro } from '~/lib/scene/intro'
import { useSeason } from '~/lib/scene/seasons'
import { m } from '~/paraglide/messages.js'
import type { UpdateSettingsInput } from '~/server/settings/settings.schemas'
import { SceneryPicker } from '../scenery-picker/scenery-picker'
import { AppearanceFields } from './appearance-fields'
import { RegionFields } from './region-fields'

export function PreferencesCard(props: { settings: Settings }) {
  const save = useUpdateSettings()
  const season = useSeason()
  const [saved, setSaved] = createSignal(false)
  let savedTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(savedTimer))

  function update(patch: UpdateSettingsInput) {
    save.mutate(patch, {
      onSuccess: () => {
        setSaved(true)
        clearTimeout(savedTimer)
        savedTimer = setTimeout(() => setSaved(false), 2000)
      },
    })
  }

  return (
    <Card role="region" id="preferences" class="scroll-mt-6" aria-labelledby="preferences-title">
      <CardHeader class="flex-row flex-wrap items-start justify-between space-y-0 gap-x-4 gap-y-1.5">
        <div class="grid gap-1.5">
          <CardTitle id="preferences-title">{m.settings_preferences()}</CardTitle>
          <CardDescription>{m.settings_preferences_description()}</CardDescription>
        </div>
        <p class="text-muted-foreground flex items-center gap-1.5 text-sm" aria-live="polite">
          <Show when={save.isError}>
            <span class="text-destructive flex items-center gap-1.5">
              <CircleAlertIcon class="size-4" aria-hidden="true" />
              {errorMessage(save.error)}
            </span>
          </Show>
          <Show when={saved() && !save.isError}>
            <CheckIcon class="size-4" aria-hidden="true" />
            {m.settings_saved()}
          </Show>
        </p>
      </CardHeader>
      <CardContent class="@container grid grid-cols-[minmax(0,1fr)] gap-6">
        <RegionFields settings={props.settings} onChange={update} />
        <Separator />
        <AppearanceFields settings={props.settings} onChange={update} />
        <Separator />
        <div id="scenery" class="grid scroll-mt-6 gap-5">
          <div class="grid gap-1">
            <h4 class="text-sm font-medium">{m.scene_title()}</h4>
            <p class="text-muted-foreground text-sm">{m.scene_description()}</p>
          </div>
          <SceneryPicker settings={props.settings} onChange={update} />
          <SceneryFields
            settings={props.settings}
            hints="long"
            intro
            onChange={update}
            tagline={{
              checked: props.settings.sceneTagline,
              onChange: (sceneTagline) => update({ sceneTagline }),
            }}
            onReplay={(focus) => playIntro({ season: season(), focus })}
          />
        </div>
      </CardContent>
    </Card>
  )
}

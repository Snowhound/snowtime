// The scenery settings (prototypes/app-frame.js, settings.html, and auth.html): the Background
// switch with Strength and Surfaces under it, Weather, and optionally Intro. The Appearance
// popover, Settings > Preferences, and the sign-in page's Scenery menu lay them out the same way.
// Each puts the collection above them in its own way; the sign-in menu's is the Collection
// select here. The signed-in ones add the Tagline switch after Weather; `hints` picks how much
// each row explains, and Settings adds "Replay it" to the Intro hint. Weather always has a hint:
// the showing image's weather, or why it's off (reduced motion, no WebGL 2, or an effect that
// didn't start).
import type { JSX } from 'solid-js'
import { For, Show, createUniqueId } from 'solid-js'
import { Label } from '~/components/ui/label'
import { NativeSelect } from '~/components/ui/native-select'
import {
  Switch,
  SwitchControl,
  SwitchDescription,
  SwitchLabel,
  SwitchThumb,
} from '~/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import {
  COLLECTIONS,
  type ImageId,
  type SceneSettings,
  createReducedMotion,
  imageFor,
  imageLabel,
  imageName,
  imageSeason,
  scenePin,
} from '~/lib/scene/scene'
import { type Hint, type Weather, weatherFor, weatherProblem } from '~/lib/scene/weather'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

type Hints = 'none' | 'short' | 'long'

const STRENGTHS = [
  { value: 'dimmed', label: m.scene_strength_dimmed },
  { value: 'full', label: m.scene_strength_full },
] as const

const SURFACES = [
  { value: 'glass', label: m.scene_surfaces_glass },
  { value: 'solid', label: m.scene_surfaces_solid },
] as const

const HINTS: Record<Hint, () => string> = {
  snow: m.scene_effect_snow,
  flurries: m.scene_effect_flurries,
  blowing: m.scene_effect_blowing,
  spray: m.scene_effect_spray,
  rain: m.scene_effect_rain,
  squall: m.scene_effect_squall,
  seeds: m.scene_effect_seeds,
  motes: m.scene_effect_motes,
  dust: m.scene_effect_dust,
  fireflies: m.scene_effect_fireflies,
  midges: m.scene_effect_midges,
  midges_night: m.scene_effect_midges_night,
  leaves: m.scene_effect_leaves,
  glitter: m.scene_effect_glitter,
  frost: m.scene_effect_frost,
  mist: m.scene_effect_mist,
  stars: m.scene_effect_stars,
  aurora: m.scene_effect_aurora,
  none: m.scene_effect_none,
}

// "falling snow", "drifting seeds by day, fireflies at night", "drifting mist and twinkling
// stars" for an image with two effects, or "still air" for an image without weather.
function themeWeather(weather: Weather) {
  const name = HINTS[weather.hint]()
  if (!weather.also) return name
  return m.scene_effect_pair({ first: name, second: HINTS[weather.also.hint]() })
}

function weatherName(id: ImageId) {
  const light = themeWeather(weatherFor(id, 'light'))
  const dark = themeWeather(weatherFor(id, 'dark'))
  if (light === dark) return light
  return m.scene_effect_day_night({ day: light, night: dark })
}

function sentence(text: string) {
  return `${text.charAt(0).toLocaleUpperCase()}${text.slice(1)}.`
}

export function SceneryFields(props: {
  settings: SceneSettings
  onChange: (patch: Partial<SceneSettings>) => void
  hints: Hints
  // The sign-in menu's Collection select; signed in, Settings has the gallery.
  collectionSelect?: boolean
  intro?: boolean
  // The page tagline's switch, an account setting shown only where signed in.
  tagline?: { checked: boolean; onChange: (checked: boolean) => void }
  // Settings' "Replay it" at the end of the Intro hint; it passes itself back for the focus.
  onReplay?: (button: HTMLButtonElement) => void
}) {
  const id = createUniqueId()
  const reducedMotion = createReducedMotion()
  function compact() {
    return props.hints === 'none'
  }
  function hint(short: () => string, long: () => string) {
    if (props.hints === 'short') return short()
    if (props.hints === 'long') return long()
    return undefined
  }
  // Why the weather can't show here, or null.
  function weatherBlocked() {
    if (reducedMotion()) return m.scene_reduced_motion()
    if (weatherProblem() === 'webgl') return m.scene_weather_no_webgl()
    if (weatherProblem() === 'failed') return m.scene_weather_failed()
    return null
  }
  function weatherHint() {
    const blocked = weatherBlocked()
    if (blocked) return blocked
    // Without the background the weather is the season's, as SceneLayer shows it.
    const image = imageFor(props.settings)
    const weather = weatherName(props.settings.sceneBackground ? image : imageSeason(image))
    return props.hints === 'long' ? m.scene_weather_hint({ weather }) : sentence(weather)
  }
  function collectionHint() {
    const image = imageFor(props.settings)
    return scenePin(props.settings)
      ? m.scene_collection_select_pinned({ image: imageName(image) })
      : m.scene_collection_select_calendar({ image: imageLabel(image) })
  }

  return (
    <>
      <Show when={props.collectionSelect}>
        <Row hints={props.hints}>
          <RowText
            hints={props.hints}
            hint={props.hints === 'none' ? undefined : collectionHint()}
            hintId={`${id}-collection-hint`}
          >
            <Label for={`${id}-collection`}>{m.scene_collection()}</Label>
          </RowText>
          <div class="shrink-0">
            <NativeSelect
              id={`${id}-collection`}
              class={cn('w-44', compact() ? 'h-8 py-1' : 'h-9')}
              value={props.settings.sceneCollection}
              aria-describedby={props.hints === 'none' ? undefined : `${id}-collection-hint`}
              onChange={(event) =>
                props.onChange({
                  sceneCollection: event.currentTarget.value as SceneSettings['sceneCollection'],
                  scenePin: null,
                })
              }
            >
              <For each={COLLECTIONS}>
                {(c) => (
                  <option value={c.id} selected={c.id === props.settings.sceneCollection}>
                    {c.label()}
                  </option>
                )}
              </For>
            </NativeSelect>
          </div>
        </Row>
      </Show>
      <SwitchRow
        hints={props.hints}
        label={m.scene_background()}
        hint={hint(m.scene_background_hint_short, m.scene_background_hint)}
        checked={props.settings.sceneBackground}
        onChange={(sceneBackground) => props.onChange({ sceneBackground })}
      />
      <OptionRow
        id={`${id}-strength`}
        hints={props.hints}
        label={m.scene_strength()}
        hint={hint(m.scene_strength_hint_short, m.scene_strength_hint)}
        options={STRENGTHS}
        value={props.settings.sceneStrength}
        disabled={!props.settings.sceneBackground}
        onChange={(value) => props.onChange({ sceneStrength: value })}
      />
      <OptionRow
        id={`${id}-surfaces`}
        hints={props.hints}
        label={m.scene_surfaces()}
        hint={hint(m.scene_surfaces_hint_short, m.scene_surfaces_hint)}
        options={SURFACES}
        value={props.settings.surfaces}
        disabled={!props.settings.sceneBackground}
        onChange={(value) => props.onChange({ surfaces: value })}
      />
      <SwitchRow
        hints={props.hints}
        label={m.scene_weather()}
        hint={weatherHint()}
        checked={props.settings.sceneWeather}
        disabled={!!weatherBlocked()}
        onChange={(sceneWeather) => props.onChange({ sceneWeather })}
      />
      <Show when={props.tagline}>
        {(tagline) => (
          <SwitchRow
            hints={props.hints}
            label={m.scene_tagline()}
            hint={hint(m.scene_tagline_hint, m.scene_tagline_hint)}
            checked={tagline().checked}
            onChange={(checked) => tagline().onChange(checked)}
          />
        )}
      </Show>
      <Show when={props.intro}>
        <SwitchRow
          hints={props.hints}
          label={m.scene_intro()}
          hint={
            reducedMotion() && props.hints !== 'long'
              ? m.scene_reduced_motion()
              : hint(m.scene_intro_hint_short, m.scene_intro_hint)
          }
          checked={props.settings.sceneIntro}
          disabled={reducedMotion()}
          onChange={(sceneIntro) => props.onChange({ sceneIntro })}
          hintEnd={
            props.onReplay && (
              <>
                {' '}
                <button
                  type="button"
                  class="hover:text-foreground underline underline-offset-4 disabled:no-underline disabled:opacity-50"
                  disabled={reducedMotion()}
                  onClick={(event) => props.onReplay?.(event.currentTarget)}
                >
                  {m.intro_replay_it()}
                </button>
              </>
            )
          }
        />
      </Show>
    </>
  )
}

// With hints, the control wraps below its text when both don't fit on one line, as on a phone.
function Row(props: { hints: Hints; indent?: boolean; children: JSX.Element }) {
  return (
    <div
      class={cn(
        'flex items-center justify-between',
        props.hints === 'none' ? 'min-h-8 gap-3' : 'flex-wrap gap-x-4 gap-y-2',
        props.indent && 'pl-3',
      )}
    >
      {props.children}
    </div>
  )
}

function RowText(props: { hints: Hints; hint?: string; hintId?: string; children: JSX.Element }) {
  return (
    // A hint keeps at least 10rem, so it doesn't narrow to a word per line.
    <div
      class={cn(
        'grid min-w-0',
        props.hints === 'long' ? 'gap-1' : 'gap-0.5',
        props.hint && 'flex-1 basis-40',
      )}
    >
      {props.children}
      <Show when={props.hint}>
        <span
          id={props.hintId}
          class={cn('text-muted-foreground', props.hints === 'long' ? 'text-sm' : 'text-xs')}
        >
          {props.hint}
        </span>
      </Show>
    </div>
  )
}

function SwitchRow(props: {
  hints: Hints
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  hintEnd?: JSX.Element
}) {
  return (
    <Switch
      class={cn(
        'flex items-center justify-between',
        props.hints === 'none' ? 'min-h-8 gap-3' : 'gap-4',
      )}
      checked={props.checked}
      disabled={props.disabled}
      onChange={(checked) => props.onChange(checked)}
    >
      <div class={cn('grid min-w-0', props.hints === 'long' ? 'gap-1' : 'gap-0.5')}>
        <SwitchLabel>{props.label}</SwitchLabel>
        <Show when={props.hint}>
          <SwitchDescription
            class={cn('text-muted-foreground', props.hints === 'long' ? 'text-sm' : 'text-xs')}
          >
            {props.hint}
            {props.hintEnd}
          </SwitchDescription>
        </Show>
      </div>
      <SwitchControl>
        <SwitchThumb />
      </SwitchControl>
    </Switch>
  )
}

function OptionRow<T extends string>(props: {
  id: string
  hints: Hints
  label: string
  hint?: string
  options: readonly { value: T; label: () => string }[]
  value: T
  disabled: boolean
  onChange: (value: T) => void
}) {
  return (
    <Row hints={props.hints} indent>
      <RowText hints={props.hints} hint={props.hint}>
        <span class="text-sm leading-none font-medium" id={props.id}>
          {props.label}
        </span>
      </RowText>
      <ToggleGroup
        variant="outline"
        size="sm"
        class="shrink-0"
        aria-labelledby={props.id}
        value={props.value}
        disabled={props.disabled}
        onChange={(value) => value && props.onChange(value as T)}
      >
        <For each={props.options}>
          {(option) => (
            <ToggleGroupItem value={option.value} class={props.hints === 'none' ? 'h-8' : ''}>
              {option.label()}
            </ToggleGroupItem>
          )}
        </For>
      </ToggleGroup>
    </Row>
  )
}

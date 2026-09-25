// The scenery settings (prototypes/app-frame.js, settings.html, and auth.html): Season, the
// Background switch with Strength and Surfaces under it, Weather, and optionally Intro. The
// Appearance popover, Settings > Preferences, and the sign-in page's Scenery menu lay them out
// the same way; `hints` picks how much each row explains, and Settings adds "Replay it" to the
// Intro hint. Weather always has a hint: the
// season's effect, or why it's off (reduced motion, no WebGL 2, or an effect that didn't start).
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
  SEASONS,
  type SceneSettings,
  createReducedMotion,
  currentSeason,
  season,
  seasonByMonth,
} from '~/lib/scene'
import { cn } from '~/lib/utils'
import { weatherProblem } from '~/lib/weather'
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

export function SceneryFields(props: {
  settings: SceneSettings
  onChange: (patch: Partial<SceneSettings>) => void
  hints: Hints
  intro?: boolean
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
    return props.hints === 'long'
      ? m.scene_weather_hint()
      : season(currentSeason(props.settings.sceneSeason)).weather()
  }

  return (
    <>
      <Row hints={props.hints}>
        <RowText hints={props.hints} hint={hint(m.scene_season_hint_short, m.scene_season_hint)}>
          <Label for={`${id}-season`}>{m.scene_season()}</Label>
        </RowText>
        <div class="shrink-0">
          <NativeSelect
            id={`${id}-season`}
            class={cn('w-36', compact() ? 'h-8 py-1' : 'h-9')}
            value={props.settings.sceneSeason}
            onChange={(event) =>
              props.onChange({
                sceneSeason: event.currentTarget.value as SceneSettings['sceneSeason'],
              })
            }
          >
            <option value="auto">
              {m.scene_season_auto({ season: season(seasonByMonth()).label().toLowerCase() })}
            </option>
            <For each={SEASONS}>{(s) => <option value={s.id}>{s.label()}</option>}</For>
          </NativeSelect>
        </div>
      </Row>
      <SwitchRow
        hints={props.hints}
        label={m.scene_background()}
        hint={hint(m.scene_background_hint, m.scene_background_hint)}
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

function Row(props: { hints: Hints; indent?: boolean; children: JSX.Element }) {
  return (
    <div
      class={cn(
        'flex items-center justify-between',
        props.hints === 'none' ? 'min-h-8 gap-3' : 'gap-4',
        props.indent && 'pl-3',
      )}
    >
      {props.children}
    </div>
  )
}

function RowText(props: { hints: Hints; hint?: string; children: JSX.Element }) {
  return (
    <div class={cn('grid min-w-0', props.hints === 'long' ? 'gap-1' : 'gap-0.5')}>
      {props.children}
      <Show when={props.hint}>
        <span class={cn('text-muted-foreground', props.hints === 'long' ? 'text-sm' : 'text-xs')}>
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

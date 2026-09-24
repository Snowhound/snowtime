// The Preferences card of the settings page (prototypes/settings.html): language and
// region, and appearance with the app icon. Each field saves on change as a one-field
// updateSettings patch.
import CheckIcon from 'lucide-solid/icons/check'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import GlobeIcon from 'lucide-solid/icons/globe'
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { AppIconDialog } from '~/components/app-icon-dialog'
import { AppMark } from '~/components/app-mark'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Label } from '~/components/ui/label'
import { NativeSelect } from '~/components/ui/native-select'
import { Separator } from '~/components/ui/separator'
import {
  Switch,
  SwitchControl,
  SwitchDescription,
  SwitchLabel,
  SwitchThumb,
} from '~/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { appIcon } from '~/lib/app-icon'
import { addDays, localDate, startOfWeek } from '~/lib/calendar'
import { errorMessage } from '~/lib/errors'
import { formatDateTime, formatIsoDate } from '~/lib/format'
import { type Settings, useUpdateSettings } from '~/lib/settings'
import { m } from '~/paraglide/messages.js'
import type { UpdateSettingsInput } from '~/server/settings/settings.schemas'

// Languages by their own names, so each reads the same in every UI language.
const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'et', label: 'Eesti' },
] as const

const WEEK_STARTS = [
  { value: 'mon', label: m.settings_week_monday },
  { value: 'sun', label: m.settings_week_sunday },
] as const

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

// "Europe/Tallinn (GMT+3)", with the zone's offset now.
function zoneLabel(zone: string) {
  const offset = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' })
    .formatToParts(Date.now())
    .find((part) => part.type === 'timeZoneName')?.value
  return `${zone.replaceAll('_', ' ')} (${offset})`
}

function weekDay(date: string) {
  return formatIsoDate(date, { weekday: 'short', day: 'numeric', month: 'short' })
}

export function PreferencesCard(props: { settings: Settings }) {
  const save = useUpdateSettings()
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

  // The zone list, the device's zone, and the clock exist only in the browser, and differ
  // from the server's, so they render after hydration.
  const [device, setDevice] = createSignal<{ zone: string; zones: string[] } | null>(null)
  const [now, setNow] = createSignal(Date.now())
  onMount(() => {
    setDevice({
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      zones: Intl.supportedValuesOf('timeZone'),
    })
    const clock = setInterval(() => setNow(Date.now()), 30_000)
    onCleanup(() => clearInterval(clock))
  })

  // A saved zone the browser doesn't list (an alias, or newer tz data) still shows.
  function zones() {
    const listed = device()?.zones ?? []
    const extra = [props.settings.timeZone, device()?.zone].filter(
      (zone): zone is string => !!zone && !listed.includes(zone),
    )
    return [...new Set([...extra, ...listed])]
  }

  function week() {
    const start = startOfWeek(localDate(now(), props.settings.timeZone), props.settings.weekStart)
    return `${weekDay(start)} – ${weekDay(addDays(start, 6))}`
  }

  const [iconDialogOpen, setIconDialogOpen] = createSignal(false)
  function icon() {
    return appIcon(props.settings.appIcon)
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
      <CardContent class="grid grid-cols-[minmax(0,1fr)] gap-6">
        <div class="grid gap-5">
          <h4 class="text-sm font-medium">{m.settings_language_and_region()}</h4>
          <div class="grid gap-2">
            <Label for="locale">{m.settings_language()}</Label>
            <div class="sm:w-56">
              <NativeSelect
                id="locale"
                value={props.settings.locale}
                onChange={(event) =>
                  update({ locale: event.currentTarget.value as Settings['locale'] })
                }
              >
                <For each={LANGUAGES}>
                  {(language) => (
                    <option value={language.value} lang={language.value}>
                      {language.label}
                    </option>
                  )}
                </For>
              </NativeSelect>
            </div>
          </div>
          <div class="grid gap-2">
            <Label for="time-zone">{m.settings_time_zone()}</Label>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <NativeSelect
                id="time-zone"
                class="sm:w-80"
                value={props.settings.timeZone}
                onChange={(event) => update({ timeZone: event.currentTarget.value })}
              >
                <For each={zones().length ? zones() : [props.settings.timeZone]}>
                  {(zone) => (
                    <option value={zone} selected={zone === props.settings.timeZone}>
                      {zoneLabel(zone)}
                    </option>
                  )}
                </For>
              </NativeSelect>
              <Button
                variant="outline"
                size="sm"
                class="self-start sm:self-auto"
                disabled={!device() || device()!.zone === props.settings.timeZone}
                title={device()?.zone}
                onClick={() => update({ timeZone: device()!.zone })}
              >
                <GlobeIcon aria-hidden="true" />
                {m.settings_use_device_zone()}
              </Button>
            </div>
          </div>
          <div class="grid gap-2">
            <span class="text-sm leading-none font-medium" id="week-start-label">
              {m.settings_week_start()}
            </span>
            <ToggleGroup
              variant="outline"
              class="justify-start"
              aria-labelledby="week-start-label"
              value={props.settings.weekStart}
              onChange={(value) => value && update({ weekStart: value as Settings['weekStart'] })}
            >
              <For each={WEEK_STARTS}>
                {(option) => (
                  <ToggleGroupItem value={option.value}>{option.label()}</ToggleGroupItem>
                )}
              </For>
            </ToggleGroup>
          </div>
          <div class="bg-muted/60 grid gap-1 rounded-md px-3 py-2.5 text-sm">
            <Show when={device()} fallback={<p aria-hidden="true">&nbsp;</p>}>
              {(device) => (
                <>
                  <p>
                    <span class="text-muted-foreground">{m.settings_preview_now()}</span>{' '}
                    {formatDateTime(now(), props.settings.timeZone, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <p>
                    <span class="text-muted-foreground">{m.settings_preview_week()}</span> {week()}
                  </p>
                  <Show when={device().zone !== props.settings.timeZone}>
                    <p class="text-muted-foreground">
                      {m.settings_preview_device_zone({ zone: device().zone.replaceAll('_', ' ') })}
                    </p>
                  </Show>
                </>
              )}
            </Show>
          </div>
        </div>
        <Separator />
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
              onChange={(id) => update({ appIcon: id })}
              onClose={() => setIconDialogOpen(false)}
            />
          </div>
          <div class="grid gap-2">
            <span class="text-sm leading-none font-medium" id="theme-label">
              {m.user_menu_theme()}
            </span>
            <ToggleGroup
              variant="outline"
              class="justify-start"
              aria-labelledby="theme-label"
              value={props.settings.theme}
              onChange={(value) => value && update({ theme: value as Settings['theme'] })}
            >
              <For each={THEMES}>
                {(option) => (
                  <ToggleGroupItem value={option.value}>{option.label()}</ToggleGroupItem>
                )}
              </For>
            </ToggleGroup>
          </div>
          <div class="grid gap-2">
            <span class="text-sm leading-none font-medium" id="layout-label">
              {m.settings_timer_layout()}
            </span>
            <ToggleGroup
              variant="outline"
              class="justify-start"
              aria-labelledby="layout-label"
              value={props.settings.timerLayout}
              onChange={(value) =>
                value && update({ timerLayout: value as Settings['timerLayout'] })
              }
            >
              <For each={LAYOUTS}>
                {(option) => (
                  <ToggleGroupItem value={option.value}>{option.label()}</ToggleGroupItem>
                )}
              </For>
            </ToggleGroup>
          </div>
          <Switch
            class="flex items-center justify-between gap-4"
            checked={props.settings.showSummary}
            onChange={(showSummary) => update({ showSummary })}
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
      </CardContent>
    </Card>
  )
}

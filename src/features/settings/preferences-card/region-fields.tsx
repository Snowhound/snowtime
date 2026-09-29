// The language and region section of the Preferences card, with a preview of the current
// date, week, and device zone.
import GlobeIcon from 'lucide-solid/icons/globe'
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { NativeSelect } from '~/components/ui/native-select'
import { addDays, localDate, startOfWeek } from '~/lib/calendar'
import { formatTimeInput } from '~/lib/date-input'
import { hourCycle } from '~/lib/display-format'
import { formatDateTime, formatHours, formatIsoDate } from '~/lib/format'
import { type Country, countryFromZone } from '~/lib/holidays/region'
import { LANGUAGES } from '~/lib/languages'
import type { Settings } from '~/lib/queries/settings'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import type { UpdateSettingsInput } from '~/server/settings/settings.schemas'
import { Choice } from './choice'

const WEEK_STARTS = [
  { value: 'mon', label: m.settings_week_monday },
  { value: 'sun', label: m.settings_week_sunday },
] as const

// The formats show as examples. 11 hours 10 minutes:
const EXAMPLE_DURATION = 40_200_000

const DURATION_FORMATS = [
  { value: 'clock', label: () => formatHours(EXAMPLE_DURATION, 'clock') },
  { value: 'units', label: () => formatHours(EXAMPLE_DURATION, 'units') },
] as const

const DATE_FORMATS = [
  { value: 'dmy', label: () => '30.09.2026' },
  { value: 'mdy', label: () => '09/30/2026' },
] as const

const TIME_FORMATS = [
  { value: '24h', label: () => formatTimeInput('15:30', `${getLocale()}-u-hc-h23`) },
  { value: '12h', label: () => formatTimeInput('15:30', `${getLocale()}-u-hc-h12`) },
] as const

const COUNTRIES = [
  { value: 'EE', label: m.settings_country_ee },
  { value: 'US', label: m.settings_country_us },
  { value: 'other', label: m.settings_country_other },
] as const

// The select's value for "From time zone", which saves as null.
const FROM_ZONE = ''

function countryName(country: Country) {
  return COUNTRIES.find((c) => c.value === country)!.label()
}

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

export function RegionFields(props: {
  settings: Settings
  onChange: (patch: UpdateSettingsInput) => void
}) {
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

  // A saved zone the browser doesn't list (an alias, or newer tz data) still shows. The list
  // fills when the select is first used: each label needs its own Intl formatter, about
  // 18 ms for all zones.
  const [zonesWanted, setZonesWanted] = createSignal(false)
  function zones() {
    if (!zonesWanted()) return [props.settings.timeZone]
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

  return (
    <div class="grid gap-5">
      <h4 class="text-sm font-medium">{m.settings_language_and_region()}</h4>
      {/* Two columns once the card is wide enough for the date formats' three toggles. */}
      <div class="grid items-start gap-x-6 gap-y-5 @2xl:grid-cols-2">
        <div class="grid gap-2">
          <Label for="locale">{m.settings_language()}</Label>
          <div class="sm:w-56">
            <NativeSelect
              id="locale"
              value={props.settings.locale}
              onChange={(event) =>
                props.onChange({ locale: event.currentTarget.value as Settings['locale'] })
              }
            >
              <For each={LANGUAGES}>
                {(language) => (
                  <option
                    value={language.value}
                    lang={language.value}
                    selected={language.value === props.settings.locale}
                  >
                    {language.label}
                  </option>
                )}
              </For>
            </NativeSelect>
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="time-zone">{m.settings_time_zone()}</Label>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center @2xl:flex-col @2xl:items-stretch">
            <NativeSelect
              id="time-zone"
              class="sm:w-80 @2xl:w-full"
              value={props.settings.timeZone}
              onPointerDown={() => setZonesWanted(true)}
              onFocus={() => setZonesWanted(true)}
              onChange={(event) => props.onChange({ timeZone: event.currentTarget.value })}
            >
              <For each={zones()}>
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
              class="self-start sm:self-auto @2xl:self-start"
              disabled={!device() || device()!.zone === props.settings.timeZone}
              title={device()?.zone}
              onClick={() => props.onChange({ timeZone: device()!.zone })}
            >
              <GlobeIcon aria-hidden="true" />
              {m.settings_use_device_zone()}
            </Button>
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="country">{m.settings_country()}</Label>
          <div class="sm:w-56">
            <NativeSelect
              id="country"
              aria-describedby="country-hint"
              value={props.settings.country ?? FROM_ZONE}
              onChange={(event) => {
                const value = event.currentTarget.value
                props.onChange({ country: value === FROM_ZONE ? null : (value as Country) })
              }}
            >
              <option value={FROM_ZONE} selected={props.settings.country === null}>
                {m.settings_country_from_zone({
                  country: countryName(countryFromZone(props.settings.timeZone)),
                })}
              </option>
              <For each={COUNTRIES}>
                {(country) => (
                  <option value={country.value} selected={country.value === props.settings.country}>
                    {country.label()}
                  </option>
                )}
              </For>
            </NativeSelect>
          </div>
          <p id="country-hint" class="text-muted-foreground text-sm">
            {m.settings_country_hint()}
          </p>
        </div>
        <Choice
          id="week-start"
          label={m.settings_week_start()}
          options={WEEK_STARTS}
          value={props.settings.weekStart}
          onChange={(weekStart) => props.onChange({ weekStart })}
        />
        <Choice
          id="duration-format"
          label={m.settings_duration_format()}
          options={DURATION_FORMATS}
          value={props.settings.durationFormat}
          onChange={(durationFormat) => props.onChange({ durationFormat })}
        />
        <Choice
          id="date-format"
          label={m.settings_date_format()}
          options={DATE_FORMATS}
          value={props.settings.dateFormat}
          onChange={(dateFormat) => props.onChange({ dateFormat })}
        />
        <Choice
          id="time-format"
          label={m.settings_time_format()}
          options={TIME_FORMATS}
          value={props.settings.timeFormat}
          onChange={(timeFormat) => props.onChange({ timeFormat })}
        />
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
                  hourCycle: hourCycle(props.settings.timeFormat),
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
  )
}

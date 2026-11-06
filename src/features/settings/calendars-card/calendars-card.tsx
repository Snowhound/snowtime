// The Calendars card (prototypes/settings.html, task 097.02): connects a Google account for
// its calendars, says when it needs reconnecting, and picks the calendars whose meetings the
// Timer page shows. Hidden when the deployment has no calendar provider set up.
import { useLocation } from '@tanstack/solid-router'
import CircleAlertIcon from 'lucide-solid/icons/circle-alert'
import LoaderCircleIcon from 'lucide-solid/icons/loader-circle'
import RefreshCwIcon from 'lucide-solid/icons/refresh-cw'
import { For, Show, createSignal } from 'solid-js'
import { GoogleIcon } from '~/components/brand-logos'
import { type Confirmation, ConfirmDialog } from '~/components/confirm-dialog'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Switch, SwitchControl, SwitchLabel, SwitchThumb } from '~/components/ui/switch'
import { errorMessage } from '~/lib/errors'
import { formatDateTime } from '~/lib/format'
import { calendarsQuery } from '~/lib/queries/calendar'
import { useQuery } from '~/lib/queries/use-query'
import { m } from '~/paraglide/messages.js'
import type { CalendarConnection, CalendarSource } from '~/server/calendar/calendar.schemas'
import { useConnectCalendar, useDisconnectCalendar, useUpdateCalendarSource } from './queries'

export function CalendarsCard(props: { timeZone: string }) {
  const calendars = useQuery(() => calendarsQuery)
  const connect = useConnectCalendar()
  const disconnect = useDisconnectCalendar()
  const updateSource = useUpdateCalendarSource()
  const location = useLocation()
  const [status, setStatus] = createSignal('')
  const [confirmation, setConfirmation] = createSignal<Confirmation | null>(null)

  // The first account; Settings connects one, and the API allows more for later.
  function connection() {
    return calendars.data?.connections[0]
  }
  function error() {
    return calendars.error ?? connect.error ?? disconnect.error ?? updateSource.error
  }

  function startConnect() {
    setStatus('')
    connect.mutate(`${location().pathname}#calendars`)
  }

  function askDisconnect(c: CalendarConnection) {
    setConfirmation({
      title: m.settings_calendars_disconnect_title(),
      description: m.settings_calendars_disconnect_description(),
      action: {
        label: m.settings_calendars_disconnect(),
        destructive: true,
        run: () => {
          setStatus('')
          disconnect.mutate(c.id, {
            onSuccess: () => setStatus(m.settings_calendars_disconnected_status()),
          })
        },
      },
    })
  }

  function since(c: CalendarConnection) {
    const date = formatDateTime(new Date(c.connectedAt), props.timeZone, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    return m.settings_calendars_since({ email: c.accountEmail, date })
  }

  return (
    <Show when={calendars.data?.available}>
      <Card role="region" id="calendars" class="scroll-mt-6" aria-labelledby="calendars-title">
        <CardHeader>
          <CardTitle id="calendars-title">{m.settings_calendars()}</CardTitle>
          <CardDescription>{m.settings_calendars_description()}</CardDescription>
        </CardHeader>
        <CardContent class="grid grid-cols-[minmax(0,1fr)] gap-6">
          <Show when={error()}>
            {(e) => (
              <Alert variant="destructive" role="alert">
                <CircleAlertIcon aria-hidden="true" />
                <AlertDescription>{errorMessage(e())}</AlertDescription>
              </Alert>
            )}
          </Show>
          <Show when={connection()?.status === 'reconnect'}>
            <Alert
              variant="warning"
              class="flex items-center gap-3 py-3 [&>svg]:static [&>svg]:shrink-0 [&>svg+div]:translate-y-0 [&>svg~*]:pl-0"
            >
              <RefreshCwIcon aria-hidden="true" />
              <AlertDescription class="flex flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <span>{m.settings_calendars_reconnect_notice()}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={connect.isPending}
                  onClick={startConnect}
                >
                  {m.settings_calendars_reconnect()}
                </Button>
              </AlertDescription>
            </Alert>
          </Show>
          <ul class="divide-y rounded-md border">
            <li class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              <div class="flex min-w-0 flex-1 items-center gap-3">
                <GoogleIcon class="size-5 shrink-0" />
                <div class="min-w-0">
                  <p class="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {m.settings_calendars_google()}
                    <Show when={connection()}>
                      {(c) => (
                        <Badge variant={c().status === 'reconnect' ? 'outline' : 'secondary'}>
                          {c().status === 'reconnect'
                            ? m.settings_calendars_needs_reconnect()
                            : m.settings_calendars_connected()}
                        </Badge>
                      )}
                    </Show>
                  </p>
                  <p class="text-muted-foreground text-sm break-words">
                    {connection() ? since(connection()!) : m.settings_calendars_not_connected()}
                  </p>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <Show
                  when={connection()}
                  fallback={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={connect.isPending}
                      onClick={startConnect}
                    >
                      <Show when={connect.isPending}>
                        <LoaderCircleIcon class="animate-spin" aria-hidden="true" />
                      </Show>
                      {m.settings_calendars_connect()}
                    </Button>
                  }
                >
                  {(c) => (
                    <Button variant="ghost" size="sm" onClick={() => askDisconnect(c())}>
                      {m.settings_calendars_disconnect()}
                    </Button>
                  )}
                </Show>
              </div>
            </li>
          </ul>
          <Show when={connection()}>
            {(c) => (
              <div class="grid grid-cols-[minmax(0,1fr)] gap-3">
                <div>
                  <h3 class="text-sm font-medium">{m.settings_calendars_list()}</h3>
                  <p class="text-muted-foreground text-sm">
                    {m.settings_calendars_list_description()}
                  </p>
                </div>
                <ul class="divide-y rounded-md border" aria-label={m.settings_calendars_list()}>
                  <For each={c().sources}>
                    {(source) => (
                      <SourceRow
                        source={source}
                        onShow={(shown) => updateSource.mutate({ id: source.id, shown })}
                      />
                    )}
                  </For>
                </ul>
              </div>
            )}
          </Show>
          <Show when={status()}>
            <p class="text-muted-foreground text-sm" aria-live="polite">
              {status()}
            </p>
          </Show>
        </CardContent>
      </Card>
      <ConfirmDialog confirmation={confirmation()} onClose={() => setConfirmation(null)} />
    </Show>
  )
}

function SourceRow(props: { source: CalendarSource; onShow: (shown: boolean) => void }) {
  return (
    <li class="flex items-center gap-3 px-4 py-3">
      <span
        class="bg-muted-foreground size-3 shrink-0 rounded-sm"
        style={props.source.color ? { background: props.source.color } : undefined}
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium">{props.source.name}</p>
        <p class="text-muted-foreground text-xs">
          {props.source.primary ? m.settings_calendars_primary() : m.settings_calendars_shared()}
        </p>
      </div>
      <Switch
        class="flex shrink-0 items-center gap-2"
        checked={props.source.shown}
        onChange={(shown) => props.onShow(shown)}
      >
        <SwitchControl>
          <SwitchThumb />
        </SwitchControl>
        <SwitchLabel class="text-sm">
          {m.settings_calendars_show()}
          <span class="sr-only">: {props.source.name}</span>
        </SwitchLabel>
      </Switch>
    </li>
  )
}

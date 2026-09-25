// Inline editing of a stopped entry (prototypes/timer.html): the entry rows' description,
// project, date, start, and end are fields that read as text until hovered or focused.
// Each field saves on its own, with only what changed. The mutation applies the change at
// once and rolls it back on error (queries.ts); the error then shows under the row.
import CalendarIcon from 'lucide-solid/icons/calendar'
import { For, Show, createEffect, createMemo, createSignal, createUniqueId, on } from 'solid-js'
import { DatePicker } from '~/components/date-time/date-picker'
import { TimeInput } from '~/components/date-time/time-input'
import { ProjectDot } from '~/components/project-dot'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Label } from '~/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { TextField, TextFieldInput, TextFieldLabel } from '~/components/ui/text-field'
import { type WeekStart, atLocalTime, localDate, localTime } from '~/lib/calendar'
import { errorMessage } from '~/lib/errors'
import { formatClock, formatIsoDate } from '~/lib/format'
import type { Project } from '~/lib/projects'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { UpdateEntryInput } from '~/server/entries/entries.schemas'
import { readEntryTimes } from './entries'
import { projectChoices } from './project-select'
import type { Entry } from './queries'

export type EntryPatch = Omit<UpdateEntryInput, 'id'>
export type SaveEntry = (entry: Entry, patch: EntryPatch) => Promise<unknown>

// The fields show their border only on hover and focus, so a row reads as text.
const QUIET =
  'h-8 border-transparent px-2 shadow-none hover:border-input focus-visible:border-input'
// Controls that show on row hover or focus from 640 px, like the row's actions.
export const REVEAL =
  'sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 data-[expanded]:opacity-100'
// The menu's value for no project; Kobalte's radio group needs a non-empty value.
const NO_PROJECT = 'none'

type TimeKey = 'start' | 'end'

// The entry's project, or a stand-in for one the user can no longer see; null for none.
export function entryProject(projects: readonly Project[], id: string | null) {
  if (!id) return null
  return projects.find((p) => p.id === id) ?? { name: m.timer_unavailable_project(), color: null }
}

export type EntryEditor = ReturnType<typeof createEntryEditor>

// The row's unsaved values and errors. Times are read like the entry popover's: on the
// start's date, with an end at or before the start on the next day.
export function createEntryEditor(props: { entry: Entry; zone: string; onSave: SaveEntry }) {
  const errorId = createUniqueId()
  // oxlint-disable-next-line solid/reactivity -- it starts from the saved value; an effect follows it.
  const [description, setDescription] = createSignal(props.entry.description)
  // Typed times not saved yet; an invalid one stays until it is fixed or Escape.
  const [times, setTimes] = createSignal<Partial<Record<TimeKey, string>>>({})
  const [invalid, setInvalid] = createSignal<TimeKey | null>(null)
  const [failed, setFailed] = createSignal<string | null>(null)

  // A saved change or its rollback replaces what the fields show. Only a changed value
  // counts, so a refetch doesn't overwrite what is being typed.
  const savedDescription = createMemo(() => props.entry.description)
  const savedTimes = createMemo(
    () => `${props.entry.startedAt.getTime()}-${props.entry.stoppedAt?.getTime()}`,
  )
  createEffect(on(savedDescription, setDescription, { defer: true }))
  createEffect(on(savedTimes, () => setTimes({}), { defer: true }))

  function date() {
    return localDate(props.entry.startedAt.getTime(), props.zone)
  }

  function values() {
    return {
      date: date(),
      start: times().start ?? localTime(props.entry.startedAt.getTime(), props.zone),
      end: times().end ?? localTime(props.entry.stoppedAt!.getTime(), props.zone),
    }
  }

  function read() {
    return readEntryTimes(values(), { running: false, zone: props.zone, original: props.entry })
  }

  // The times' error, on the field it belongs to; `key` is the field being committed.
  function timesError(key: TimeKey): { key: TimeKey; message: string } | null {
    const { start, end } = values()
    if (!start) return { key: 'start', message: m.entry_error_missing_start() }
    if (!end) return { key: 'end', message: m.entry_error_missing_end() }
    const result = read()
    if (!result.error) return null
    return {
      key,
      message: result.error === 'future' ? m.entry_error_future() : m.entry_error_missing(),
    }
  }

  // After a failed commit, the error follows the input until it is fixed.
  function shownInvalid() {
    const key = invalid()
    return key ? timesError(key) : null
  }

  function save(patch: EntryPatch) {
    setFailed(null)
    props
      .onSave(props.entry, patch)
      .catch((error: unknown) => setFailed(m.entry_save_failed({ error: errorMessage(error) })))
  }

  // Moves the entry to `value`, keeping its times of day, seconds, and duration.
  function readDate(value: string) {
    if (!value) return { error: m.entry_error_missing_date() }
    const { startedAt, stoppedAt } = props.entry
    const seconds = startedAt.getTime() % 60_000
    const start =
      atLocalTime(value, localTime(startedAt.getTime(), props.zone), props.zone) + seconds
    const stop = start + stoppedAt!.getTime() - startedAt.getTime()
    if (stop > Date.now()) return { error: m.entry_error_future() }
    return { startedAt: new Date(start), stoppedAt: new Date(stop) }
  }

  return {
    errorId,
    date,
    save,
    readDate,
    description,
    setDescription,
    commitDescription() {
      const value = description().trim()
      if (value === props.entry.description) setDescription(value)
      else save({ description: value })
    },
    resetDescription() {
      setDescription(props.entry.description)
    },
    time(key: TimeKey) {
      return values()[key]
    },
    setTime(key: TimeKey, value: string) {
      setTimes((t) => ({ ...t, [key]: value }))
    },
    invalid() {
      return shownInvalid()?.key ?? null
    },
    commitTimes(key: TimeKey) {
      if (times().start === undefined && times().end === undefined) return
      const error = timesError(key)
      if (error) {
        setInvalid(error.key)
        return
      }
      setInvalid(null)
      const result = read()
      if (result.error) return
      const patch: EntryPatch = {}
      if (result.startedAt.getTime() !== props.entry.startedAt.getTime()) {
        patch.startedAt = result.startedAt
      }
      if (result.stoppedAt!.getTime() !== props.entry.stoppedAt!.getTime()) {
        patch.stoppedAt = result.stoppedAt!
      }
      if (Object.keys(patch).length === 0) setTimes({})
      else save(patch)
    },
    resetTime(key: TimeKey) {
      setTimes((t) => {
        const rest = { ...t }
        delete rest[key]
        return rest
      })
    },
    commitDate(value: string) {
      if (value === date()) return
      const result = readDate(value)
      if (!('error' in result)) save(result)
    },
    duration() {
      const result = read()
      return result.error ? null : result.stoppedAt!.getTime() - result.startedAt.getTime()
    },
    nextDay() {
      const result = read()
      return !result.error && result.nextDay
    },
    error() {
      return shownInvalid()?.message ?? failed()
    },
  }
}

// Enter saves the field and Escape restores the saved value.
function commitKeys(commit: () => void, reset: () => void) {
  return (event: KeyboardEvent) => {
    if (event.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      reset()
    }
  }
}

export function DescriptionField(props: { editor: EntryEditor }) {
  return (
    <TextField value={props.editor.description()} onChange={props.editor.setDescription}>
      <TextFieldLabel class="sr-only">{m.entry_description()}</TextFieldLabel>
      <TextFieldInput
        autocomplete="off"
        placeholder={m.timer_no_description()}
        class={cn(QUIET, 'text-ellipsis')}
        onBlur={() => props.editor.commitDescription()}
        onKeyDown={commitKeys(
          () => props.editor.commitDescription(),
          () => props.editor.resetDescription(),
        )}
      />
    </TextField>
  )
}

// From 640 px the start time's clock takes no room until the pointer or focus is on that field,
// so the range reads "09:30 – 17:00" rather than with a gap before the dash. A row keeps the
// room after the range instead (ClockRoom), which the clock takes when it shows, so only the end
// time moves. The end time's clock keeps its room, as the row's other hover controls do.
const START_CLOCK =
  'sm:hidden sm:group-hover/start:inline-flex sm:group-focus-within/start:inline-flex sm:group-has-data-expanded/start:inline-flex'
const START_CLOCK_ROOM =
  'sm:pr-0 sm:group-hover/start:pr-7 sm:group-focus-within/start:pr-7 sm:group-has-data-expanded/start:pr-7'

// The start clock's room at the end of a row's range: the clock's size-6 and ml-0.5, less the
// row's gap-1, which goes with it.
export function ClockRoom() {
  return (
    <span
      aria-hidden="true"
      class="hidden w-5.5 shrink-0 sm:block sm:peer-focus-within/start:hidden sm:peer-hover/start:hidden sm:peer-has-data-expanded/start:hidden"
    />
  )
}

export function TimeField(props: { editor: EntryEditor; field: TimeKey }) {
  function start() {
    return props.field === 'start'
  }
  return (
    <TimeInput
      value={props.editor.time(props.field)}
      onChange={(value) => props.editor.setTime(props.field, value)}
      invalid={props.editor.invalid() === props.field}
      required
      aria-label={props.field === 'start' ? m.entry_start() : m.entry_end()}
      aria-describedby={props.editor.errorId}
      class={cn('w-fit shrink-0', start() && 'peer/start group/start')}
      inputClass={cn(QUIET, 'pr-7', start() && START_CLOCK_ROOM)}
      textClass="pl-1.5 text-xs"
      buttonClass={cn('ml-0.5 size-6 [&_svg]:size-3.5', start() ? START_CLOCK : REVEAL)}
      onCommit={() => props.editor.commitTimes(props.field)}
      onKeyDown={commitKeys(
        () => props.editor.commitTimes(props.field),
        () => props.editor.resetTime(props.field),
      )}
    />
  )
}

// A menu rather than ProjectSelect: its trigger reads like the row's text, and every
// option has its color dot.
export function ProjectField(props: {
  editor: EntryEditor
  entry: Entry
  projects: readonly Project[]
}) {
  function current() {
    return entryProject(props.projects, props.entry.projectId)
  }
  function name() {
    return current()?.name ?? m.timer_no_project()
  }
  return (
    <DropdownMenu placement="bottom-start">
      <DropdownMenuTrigger
        as={Button<'button'>}
        variant="ghost"
        size="sm"
        class={cn(
          'h-8 w-full min-w-0 justify-start gap-1.5 px-2 text-xs font-normal',
          !current() && 'text-muted-foreground',
        )}
        aria-label={m.entry_row_project({ project: name() })}
      >
        <Show when={current()}>{(p) => <ProjectDot color={p().color} />}</Show>
        <span class="min-w-0 truncate">{name()}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuRadioGroup
          value={props.entry.projectId ?? NO_PROJECT}
          onChange={(value) => {
            const projectId = value === NO_PROJECT ? null : value
            if (projectId !== props.entry.projectId) props.editor.save({ projectId })
          }}
        >
          <For each={projectChoices(props.projects, props.entry.projectId ?? '')}>
            {(choice) => (
              <DropdownMenuRadioItem value={choice.value || NO_PROJECT} class="gap-2">
                <Show when={choice.value}>
                  <ProjectDot color={choice.color} />
                </Show>
                <span class="min-w-0 truncate">{choice.label}</span>
              </DropdownMenuRadioItem>
            )}
          </For>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Moves the entry to another day, a rare change that would otherwise widen every row. It
// saves when the popover closes or on Enter; Escape or an invalid date changes nothing.
export function DateField(props: { editor: EntryEditor; zone: string; weekStart: WeekStart }) {
  const inputId = createUniqueId()
  const errorId = createUniqueId()
  const [open, setOpen] = createSignal(false)
  const [value, setValue] = createSignal('')
  let cancelled = false

  function error() {
    const result = props.editor.readDate(value())
    return 'error' in result ? result.error : null
  }

  function today() {
    return localDate(Date.now(), props.zone)
  }

  function openChange(next: boolean) {
    if (next) {
      setValue(props.editor.date())
      cancelled = false
    } else if (!cancelled && !error()) {
      props.editor.commitDate(value())
    }
    setOpen(next)
  }

  return (
    <Popover open={open()} onOpenChange={openChange} placement="bottom-start">
      <PopoverTrigger
        as={Button<'button'>}
        variant="ghost"
        size="icon"
        class={cn('text-muted-foreground size-8', REVEAL)}
        aria-label={m.entry_row_date({
          date: formatIsoDate(props.editor.date(), {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }),
        })}
      >
        <CalendarIcon aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        class="grid w-auto gap-2 p-3"
        onEscapeKeyDown={() => {
          cancelled = true
        }}
      >
        <div class="grid gap-1.5">
          <Label for={inputId}>{m.entry_date()}</Label>
          <DatePicker
            id={inputId}
            value={value()}
            onChange={(next, how) => {
              setValue(next)
              if ((how === 'enter' || how === 'pick') && !error()) openChange(false)
            }}
            weekStart={props.weekStart}
            today={today()}
            max={today()}
            invalid={!!error()}
            aria-describedby={errorId}
            live
            inline
          />
          <Show when={error()}>
            <p id={errorId} class="text-destructive text-xs">
              {error()}
            </p>
          </Show>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Read-only: start and end set it, and it follows them while the user types.
export function EntryDuration(props: { editor: EntryEditor; class?: string }) {
  return (
    <span class={props.class}>
      {props.editor.duration() === null ? '—' : formatClock(props.editor.duration()!)}
    </span>
  )
}

export function NextDayMark(props: { editor: EntryEditor }) {
  return (
    <span class="text-muted-foreground w-5 text-xs" title={m.entry_row_next_day()}>
      <Show when={props.editor.nextDay()}>
        <span aria-hidden="true">+1</span>
        <span class="sr-only">{m.entry_row_next_day()}</span>
      </Show>
    </span>
  )
}

export function RowError(props: { editor: EntryEditor }) {
  return (
    <Show when={props.editor.error()}>
      {(error) => (
        <p id={props.editor.errorId} role="alert" class="text-destructive pt-1 text-xs">
          {error()}
        </p>
      )}
    </Show>
  )
}

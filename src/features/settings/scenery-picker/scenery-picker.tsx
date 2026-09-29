// The scenery collection and pin in Settings > Preferences > Scenery (prototypes/settings.html,
// prototypes/README.md, "Scenery collections"). Each collection is a radio card showing all its
// images, with the one showing now outlined. Choosing one saves at once and the scene behind the
// page changes, which is the preview. Pinning is rare, so its options are a second radio group
// behind "Pin an image".
import CalendarIcon from 'lucide-solid/icons/calendar'
import CheckIcon from 'lucide-solid/icons/check'
import ChevronDownIcon from 'lucide-solid/icons/chevron-down'
import PinIcon from 'lucide-solid/icons/pin'
import { For, type JSX, Show, createUniqueId } from 'solid-js'
import { SceneThumb } from '~/components/scene/scene-thumb'
import {
  COLLECTIONS,
  type CollectionId,
  type ImageId,
  type SceneSettings,
  calendarImage,
  collection,
  imageLabel,
  imageName,
  imageShort,
  scenePin,
} from '~/lib/scene/scene'
import { m } from '~/paraglide/messages.js'

type Choice = Pick<SceneSettings, 'sceneCollection' | 'scenePin'>

export function SceneryPicker(props: { settings: Choice; onChange: (patch: Choice) => void }) {
  const id = createUniqueId()
  function pin() {
    return scenePin(props.settings)
  }
  function calendar() {
    return calendarImage(props.settings.sceneCollection)
  }
  function chooseCollection(value: CollectionId) {
    if (value !== props.settings.sceneCollection) {
      props.onChange({ sceneCollection: value, scenePin: null })
    }
  }
  function choosePin(value: ImageId | null) {
    if (value !== pin()) {
      props.onChange({ sceneCollection: props.settings.sceneCollection, scenePin: value })
    }
  }

  return (
    <div class="grid gap-3">
      <div class="grid gap-1">
        <span class="text-sm leading-none font-medium" id={`${id}-label`}>
          {m.scene_collection()}
        </span>
        <span class="text-muted-foreground text-sm" id={`${id}-hint`}>
          {m.scene_collection_hint()}
        </span>
      </div>
      <RadioGroup
        class="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
      >
        <For each={COLLECTIONS}>
          {(c) => {
            function checked() {
              return c.id === props.settings.sceneCollection
            }
            function shown() {
              return (checked() && pin()) || calendarImage(c.id)
            }
            function status() {
              return checked() && pin()
                ? m.scene_collection_pinned({ image: imageName(shown()) })
                : m.scene_collection_now({ image: imageName(shown()) })
            }
            return (
              <button
                type="button"
                role="radio"
                aria-checked={checked()}
                tabIndex={checked() ? 0 : -1}
                aria-labelledby={`${id}-${c.id}-name`}
                aria-describedby={`${id}-${c.id}-description`}
                class="group bg-background/60 hover:bg-accent/70 focus-visible:ring-ring focus-visible:ring-offset-background aria-checked:border-primary aria-checked:bg-accent/70 aria-checked:ring-primary flex items-center gap-3 rounded-xl border p-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none aria-checked:ring-1 sm:flex-col sm:items-stretch sm:gap-2.5"
                onClick={(event) => {
                  event.currentTarget.focus()
                  chooseCollection(c.id)
                }}
              >
                <span
                  class={`bg-border grid aspect-[16/10] w-32 shrink-0 gap-px overflow-hidden rounded-lg sm:w-full ${c.by === 'month' ? 'grid-cols-4 grid-rows-3' : 'grid-cols-2 grid-rows-2'}`}
                  aria-hidden="true"
                >
                  <For each={c.images}>
                    {(image) => (
                      <Tile
                        id={image}
                        shown={image === shown()}
                        pinned={checked() && image === pin()}
                      />
                    )}
                  </For>
                </span>
                <span class="flex min-w-0 flex-1 items-start justify-between gap-2 sm:px-1 sm:pb-1">
                  <span class="grid min-w-0 gap-1">
                    <span id={`${id}-${c.id}-name`} class="text-sm leading-tight font-medium">
                      {c.label()}
                    </span>
                    <span
                      id={`${id}-${c.id}-description`}
                      class="text-muted-foreground text-xs"
                    >{`${c.description()}. ${status()}.`}</span>
                  </span>
                  <span class="bg-primary text-primary-foreground hidden size-5 shrink-0 items-center justify-center rounded-full group-aria-checked:flex">
                    <CheckIcon class="size-3" aria-hidden="true" />
                  </span>
                </span>
              </button>
            )
          }}
        </For>
      </RadioGroup>
      <details class="group/pin">
        <summary class="focus-visible:ring-ring flex min-h-9 cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md text-sm focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          {/* The setting's current value; the disclosure changes it. */}
          <span class="text-muted-foreground flex min-w-0 items-center gap-1.5">
            <Show
              when={pin()}
              fallback={
                <>
                  <CalendarIcon class="size-3.5 shrink-0" aria-hidden="true" />
                  <span>{m.scene_pin_status_calendar({ image: imageName(calendar()) })}</span>
                </>
              }
            >
              {(pinned) => (
                <>
                  <PinIcon class="size-3.5 shrink-0" aria-hidden="true" />
                  <span>{m.scene_pin_status_pinned({ image: imageName(pinned()) })}</span>
                </>
              )}
            </Show>
          </span>
          <span class="text-primary flex items-center gap-1 font-medium underline-offset-4 hover:underline">
            {m.scene_pin_open()}
            <ChevronDownIcon
              class="size-4 transition-transform group-open/pin:rotate-180"
              aria-hidden="true"
            />
          </span>
        </summary>
        <span id={`${id}-pin-label`} class="sr-only">
          {m.scene_pin_group({ collection: collection(props.settings.sceneCollection).label() })}
        </span>
        <RadioGroup class="mt-2 flex flex-wrap gap-2" aria-labelledby={`${id}-pin-label`}>
          <PinOption
            checked={!pin()}
            label={m.scene_pin_calendar()}
            name={m.scene_pin_calendar_name({ image: imageName(calendar()) })}
            onChoose={() => choosePin(null)}
          >
            <span class="bg-muted text-muted-foreground absolute inset-0 flex items-center justify-center">
              <CalendarIcon class="size-4" aria-hidden="true" />
            </span>
          </PinOption>
          <For each={collection(props.settings.sceneCollection).images}>
            {(image) => (
              <PinOption
                checked={image === pin()}
                label={imageLabel(image)}
                onChoose={() => choosePin(image)}
              >
                <SceneThumb id={image} class="absolute inset-0" />
              </PinOption>
            )}
          </For>
        </RadioGroup>
      </details>
    </div>
  )
}

// One gallery tile: the image, its short name, a pin badge when pinned, and an outline when it
// shows.
function Tile(props: { id: ImageId; shown: boolean; pinned: boolean }) {
  return (
    <span class="relative min-h-0 overflow-hidden">
      <SceneThumb id={props.id} class="absolute inset-0" />
      <span class="absolute bottom-0.5 left-1 text-[10px] leading-none font-semibold text-white [text-shadow:0_0_3px_rgb(0_0_0/0.7),0_1px_1px_rgb(0_0_0/0.5)]">
        {imageShort(props.id)}
      </span>
      <Show when={props.pinned}>
        <span class="bg-background/90 text-foreground absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full">
          <PinIcon class="size-2.5" />
        </span>
      </Show>
      <Show when={props.shown}>
        <span class="absolute inset-0 ring-2 ring-white ring-inset" />
      </Show>
    </span>
  )
}

function PinOption(props: {
  checked: boolean
  label: string
  // The accessible name, when it says more than the label.
  name?: string
  onChoose: () => void
  children: JSX.Element
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.checked}
      tabIndex={props.checked ? 0 : -1}
      aria-label={props.name ?? props.label}
      class="group hover:bg-accent focus-visible:ring-ring aria-checked:bg-accent grid w-20 gap-1 rounded-md p-1 text-center text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none aria-checked:font-medium"
      onClick={(event) => {
        event.currentTarget.focus()
        props.onChoose()
      }}
    >
      <span class="ring-border group-aria-checked:ring-primary relative aspect-video overflow-hidden rounded-sm ring-1 group-aria-checked:ring-2">
        {props.children}
      </span>
      <span class="truncate">{props.label}</span>
    </button>
  )
}

// A radio group of buttons with role="radio": the checked one is the group's tab stop, arrow
// keys move and choose, and Home and End jump.
function RadioGroup(props: {
  class: string
  'aria-labelledby': string
  'aria-describedby'?: string
  children: JSX.Element
}) {
  let group!: HTMLDivElement
  function onKeyDown(event: KeyboardEvent) {
    const options = [...group.querySelectorAll<HTMLButtonElement>(':scope > [role="radio"]')]
    const i = options.indexOf(event.target as HTMLButtonElement)
    if (i < 0) return
    const moves: Record<string, number> = {
      ArrowLeft: i - 1,
      ArrowUp: i - 1,
      ArrowRight: i + 1,
      ArrowDown: i + 1,
      Home: 0,
      End: options.length - 1,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    options[(next + options.length) % options.length].click()
  }
  return (
    <div
      ref={group}
      role="radiogroup"
      class={props.class}
      aria-labelledby={props['aria-labelledby']}
      aria-describedby={props['aria-describedby']}
      onKeyDown={onKeyDown}
    >
      {props.children}
    </div>
  )
}

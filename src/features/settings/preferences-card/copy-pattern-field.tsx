// The copyDurationPattern setting (prototypes/copy-durations.html): a pattern field with a live
// preview, a key to its letters, example patterns, and a reset. It saves on blur or Enter; an
// invalid pattern shows its error and isn't saved, and Escape returns to the saved one.
import { For, Show, createEffect, createSignal, on } from 'solid-js'
import { Button } from '~/components/ui/button'
import {
  TextField,
  TextFieldErrorMessage,
  TextFieldInput,
  TextFieldLabel,
} from '~/components/ui/text-field'
import {
  DEFAULT_COPY_PATTERN,
  MAX_COPY_PATTERN,
  type PatternToken,
  fieldsInWords,
  formatDurationPattern,
  tokenizePattern,
  validDurationPattern,
} from '~/lib/duration-pattern'
import { formatClock } from '~/lib/format'
import { m } from '~/paraglide/messages.js'
import type { UpdateSettingsInput } from '~/server/settings/settings.schemas'

// 2:05:09, which shows padding in every field.
const PREVIEW_MS = 7_509_000
// The last shows the backslash: `2 Hours 5 Minutes`.
const EXAMPLES = [DEFAULT_COPY_PATTERN, 'Hh Mm Ss', 'HH:MM', 'M:SS', 'H \\Hours M \\Minutes']

// Colors only, no weight or padding, so the colored copy behind the input keeps the input's
// character widths and lines up with its caret.
const TOKEN_CLASS: Record<PatternToken['kind'], string> = {
  field: 'bg-primary/15 text-primary rounded-xs',
  escape: 'text-foreground',
  text: 'text-muted-foreground',
}

// The pattern with its fields colored, as the field, the key, and the examples show it. One
// span, so a flex parent such as a button doesn't put its gap between the pieces.
function PatternText(props: { pattern: string }) {
  return (
    <span>
      <For each={tokenizePattern(props.pattern)}>
        {(token) =>
          token.kind === 'escape' ? (
            <span>
              <span class="text-muted-foreground/70">\</span>
              <span class={TOKEN_CLASS.escape}>{token.text}</span>
            </span>
          ) : (
            <span class={TOKEN_CLASS[token.kind]}>{token.source}</span>
          )
        }
      </For>
    </span>
  )
}

export function CopyPatternField(props: {
  value: string
  onChange: (patch: UpdateSettingsInput) => void
}) {
  // oxlint-disable-next-line solid/reactivity -- it starts from the saved value; an effect follows it.
  const [draft, setDraft] = createSignal(props.value)
  createEffect(
    on(
      () => props.value,
      (value) => setDraft(value),
      { defer: true },
    ),
  )
  // The input's horizontal scroll, which the colored copy behind it follows.
  const [scroll, setScroll] = createSignal(0)

  function valid() {
    return validDurationPattern(draft())
  }

  function inWords() {
    return fieldsInWords(draft())
  }

  function save(pattern = draft()) {
    setDraft(pattern)
    if (validDurationPattern(pattern) && pattern !== props.value) {
      props.onChange({ copyDurationPattern: pattern })
    }
  }

  function follow(event: Event) {
    setScroll((event.currentTarget as HTMLInputElement).scrollLeft)
  }

  return (
    <div class="grid gap-3">
      <TextField
        class="grid gap-2"
        value={draft()}
        onChange={setDraft}
        validationState={valid() ? 'valid' : 'invalid'}
      >
        <TextFieldLabel>{m.settings_copy_duration_pattern()}</TextFieldLabel>
        <div class="flex gap-2 sm:w-80">
          <div class="relative min-w-0 flex-1">
            {/* The colored copy: the input's text is transparent, so only its caret and
                selection show over it. */}
            <div
              aria-hidden="true"
              class="pointer-events-none absolute inset-0 flex items-center overflow-hidden border border-transparent px-3 font-mono text-sm whitespace-pre"
            >
              <span style={{ transform: `translateX(${-scroll()}px)` }}>
                <PatternText pattern={draft()} />
              </span>
            </div>
            <TextFieldInput
              id="copy-duration-pattern"
              class="caret-foreground relative font-mono text-transparent data-[invalid]:text-transparent"
              autocomplete="off"
              spellcheck={false}
              maxLength={MAX_COPY_PATTERN}
              aria-describedby="copy-duration-preview copy-duration-key"
              onScroll={follow}
              onInput={follow}
              onKeyUp={follow}
              onSelect={follow}
              onBlur={() => save()}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.isComposing) return
                if (event.key === 'Enter') {
                  event.preventDefault()
                  save()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setDraft(props.value)
                }
              }}
            />
          </div>
          <Button
            variant="outline"
            title={m.settings_copy_duration_reset_title({ pattern: DEFAULT_COPY_PATTERN })}
            disabled={props.value === DEFAULT_COPY_PATTERN && draft() === DEFAULT_COPY_PATTERN}
            onClick={() => save(DEFAULT_COPY_PATTERN)}
          >
            {m.settings_copy_duration_reset()}
          </Button>
        </div>
        <TextFieldErrorMessage>{m.validation_copy_duration_pattern()}</TextFieldErrorMessage>
      </TextField>
      {/* The preview, and a warning about a field inside a word under it. */}
      <div id="copy-duration-preview" class="grid gap-1 text-sm" aria-live="polite">
        <Show when={valid()}>
          <p>
            <span class="text-muted-foreground">
              {m.settings_copy_duration_preview({ example: formatClock(PREVIEW_MS) })}
            </span>{' '}
            <span class="font-mono font-medium">{formatDurationPattern(PREVIEW_MS, draft())}</span>
          </p>
          <Show when={inWords()[0]}>
            {(field) => (
              <p>{m.settings_copy_duration_in_word({ field: field(), escaped: `\\${field()}` })}</p>
            )}
          </Show>
        </Show>
      </div>
      <div
        class="flex flex-wrap gap-1.5"
        role="group"
        aria-label={m.settings_copy_duration_examples()}
      >
        <For each={EXAMPLES}>
          {(example) => (
            <Button
              variant="outline"
              size="sm"
              class="font-mono"
              aria-label={example}
              onClick={() => save(example)}
            >
              <PatternText pattern={example} />
            </Button>
          )}
        </For>
      </div>
      <dl
        id="copy-duration-key"
        class="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"
      >
        <dt class="font-mono">
          <PatternText pattern="H M S" />
        </dt>
        <dd>{m.settings_copy_duration_key_fields()}</dd>
        <dt class="font-mono">
          <PatternText pattern="HH" />
        </dt>
        <dd>{m.settings_copy_duration_key_padded()}</dd>
        <dt class="font-mono">
          <PatternText pattern="\Hours" />
        </dt>
        <dd>{m.settings_copy_duration_key_escaped()}</dd>
        <dt class="font-mono">{m.settings_copy_duration_key_other()}</dt>
        <dd>{m.settings_copy_duration_key_other_text()}</dd>
      </dl>
      <p class="text-muted-foreground text-xs">{m.settings_copy_duration_case()}</p>
      <p class="text-muted-foreground text-xs">{m.settings_copy_duration_largest()}</p>
    </div>
  )
}

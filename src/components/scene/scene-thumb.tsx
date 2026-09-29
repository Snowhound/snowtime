// An image's light and dark thumbnails (prototypes/app-frame.js, `thumbPair`); the page's theme
// shows one. The hidden one's background doesn't load.
import { For } from 'solid-js'
import { type ImageId, thumbUrl } from '~/lib/scene/scene'
import { cn } from '~/lib/utils'

export function SceneThumb(props: { id: ImageId; class?: string }) {
  return (
    <For each={['light', 'dark'] as const}>
      {(theme) => (
        <span
          class={cn(
            'ring-border bg-cover bg-center ring-1',
            theme === 'light' ? 'dark:hidden' : 'hidden dark:block',
            props.class,
          )}
          style={{ 'background-image': `url("${thumbUrl(props.id, theme)}")` }}
          aria-hidden="true"
        />
      )}
    </For>
  )
}

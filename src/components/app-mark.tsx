import { type AppIconId, appMarkSrc } from '~/lib/app-icon'
import { cn } from '~/lib/utils'

// An app icon concept's bare mark for the page's theme, fitted into a square since the marks
// aren't square. The server can't resolve the "system" theme, so both versions render and the
// `dark` class on <html> picks one, without a flash on the first paint.
export function AppMark(props: { id: AppIconId; small?: boolean; class?: string }) {
  return (
    <>
      <img
        src={appMarkSrc(props.id, false, props.small)}
        alt=""
        class={cn('shrink-0 object-contain dark:hidden', props.class)}
      />
      <img
        src={appMarkSrc(props.id, true, props.small)}
        alt=""
        class={cn('hidden shrink-0 object-contain dark:block', props.class)}
      />
    </>
  )
}

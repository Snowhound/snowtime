// A day's total in the entry list's and table's day headers, which a click copies. The bubble
// shows to its left, since the day's card would clip it above.
import { CopyDuration } from '~/components/copy-duration'
import { Duration } from '~/components/duration'
import { useFormatHours } from '~/lib/display-format'

export function DayTotal(props: { ms: number }) {
  const formatHours = useFormatHours()
  return (
    <CopyDuration ms={props.ms} label={formatHours(props.ms)} side="left">
      <Duration ms={props.ms} />
    </CopyDuration>
  )
}

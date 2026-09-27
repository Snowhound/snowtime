// What a view shows when the range has no time.
import ChartColumnIcon from 'lucide-solid/icons/chart-column'
import { m } from '~/paraglide/messages.js'

export function EmptyState() {
  return (
    <div class="px-6 pb-6">
      <div class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
        <ChartColumnIcon class="text-muted-foreground size-6" aria-hidden="true" />
        <p class="font-medium">{m.reports_empty_title()}</p>
        <p class="text-muted-foreground text-sm">{m.reports_empty_description()}</p>
      </div>
    </div>
  )
}

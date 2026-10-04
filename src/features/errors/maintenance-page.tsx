import WrenchIcon from 'lucide-solid/icons/wrench'
import { onCleanup, onMount } from 'solid-js'
import { checkAvailability } from '~/lib/api/availability'
import { m } from '~/paraglide/messages.js'
import { StatusPage } from './status-page'

const CHECK_INTERVAL_MS = 15_000

// Shown in place of a page while the database is unreachable. It checks every 15 seconds
// while the tab is visible, and at once when the window gets focus, the tab comes back, or
// the device goes online, then calls onAvailable to load the page that failed.
export function MaintenancePage(props: { onAvailable: () => Promise<void> }) {
  let checking = false
  async function check() {
    if (checking || document.visibilityState === 'hidden') return
    checking = true
    try {
      if (await checkAvailability()) await props.onAvailable()
    } catch {
      // The app itself is unreachable; the next check tries again.
    } finally {
      checking = false
    }
  }

  onMount(() => {
    const interval = setInterval(check, CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    onCleanup(() => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
    })
  })

  return (
    <StatusPage
      icon={<WrenchIcon aria-hidden="true" />}
      title={m.maintenance_title()}
      description={m.maintenance_description()}
      home={false}
    />
  )
}

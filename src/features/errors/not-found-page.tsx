import CompassIcon from 'lucide-solid/icons/compass'
import { m } from '~/paraglide/messages.js'
import { StatusPage } from './status-page'

// An unknown path, or a route that threw notFound() for a missing record. The server
// answers 404.
export function NotFoundPage() {
  return (
    <StatusPage
      icon={<CompassIcon aria-hidden="true" />}
      title={m.page_not_found_title()}
      description={m.page_not_found_description()}
    />
  )
}

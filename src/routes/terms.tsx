import { createFileRoute } from '@tanstack/solid-router'
import { TermsPage } from '~/features/legal/terms-page'
import { m } from '~/paraglide/messages.js'

// Public, signed in or not, like the privacy policy.
export const Route = createFileRoute('/terms')({
  head: () => ({ meta: [{ title: `${m.legal_terms_title()} · ${m.app_name()}` }] }),
  component: TermsPage,
})

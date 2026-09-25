import { createFileRoute } from '@tanstack/solid-router'
import { PrivacyPage } from '~/features/legal/privacy-page'
import { m } from '~/paraglide/messages.js'

// Public, signed in or not: the sign-in providers link to it (docs/deployment.md).
export const Route = createFileRoute('/privacy')({
  head: () => ({ meta: [{ title: `${m.legal_privacy_title()} · ${m.app_name()}` }] }),
  component: PrivacyPage,
})

import { Link } from '@tanstack/solid-router'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

// Links to the privacy policy and terms, under the signed-out screens' card and at the foot
// of the legal pages.
export function LegalLinks(props: { class?: string }) {
  return (
    <nav
      class={cn(
        'text-muted-foreground flex gap-4 text-xs [&_a:hover]:text-foreground',
        props.class,
      )}
      aria-label={m.legal_links()}
    >
      <Link to="/privacy">{m.legal_privacy_title()}</Link>
      <Link to="/terms">{m.legal_terms_title()}</Link>
    </nav>
  )
}

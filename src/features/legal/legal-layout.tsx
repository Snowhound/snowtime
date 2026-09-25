import { useQuery } from '@tanstack/solid-query'
import { Link } from '@tanstack/solid-router'
import type { JSX } from 'solid-js'
import { AppMark } from '~/components/app-mark'
import { LegalLinks } from '~/components/legal-links'
import { appIcon } from '~/lib/app-icon'
import { deviceSettings } from '~/lib/device-settings'
import { sessionQuery } from '~/lib/session'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'

// The operator the privacy policy and terms name. A dedicated stack run by someone else
// replaces these and the documents' text (docs/deployment.md).
export const COMPANY = {
  name: 'Snowhound OÜ',
  registryCode: '12745389',
  address: 'Meistri tn 14, 13517 Tallinn',
  email: 'info@snowhound.eu',
  site: 'snowtime.snowhound.eu',
}

export function ContactEmail() {
  return <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>
}

// A legal document's page: public, signed in or not, with plain prose instead of the
// seasonal scene so it stays easy to read. The content styles its elements through the
// article's descendant classes.
export function LegalLayout(props: { title: string; updated: string; children: JSX.Element }) {
  const session = useQuery(() => sessionQuery)
  function appIconId() {
    return appIcon(session.data?.settings?.appIcon ?? deviceSettings()?.appIcon).id
  }
  function updated() {
    const date = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long', timeZone: 'UTC' })
    return date.format(new Date(props.updated))
  }

  return (
    <div class="bg-background text-foreground min-h-dvh">
      <main class="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10 sm:py-16">
        <Link
          to="/"
          class="flex items-center gap-2 self-start text-base font-bold tracking-[-0.02em]"
        >
          <AppMark id={appIconId()} small class="size-7" />
          {m.app_name()}
        </Link>
        <article class="text-sm leading-6 [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul_ul]:mt-1">
          <h1 class="text-2xl font-semibold tracking-tight">{props.title}</h1>
          <p class="text-muted-foreground">{m.legal_updated({ date: updated() })}</p>
          {props.children}
        </article>
        <LegalLinks class="border-t pt-6" />
      </main>
    </div>
  )
}

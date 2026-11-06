import { createFileRoute } from '@tanstack/solid-router'
import { AboutPage } from '~/features/legal/about-page'
import { m } from '~/paraglide/messages.js'

// Public, signed in or not: the home page the Google OAuth client names.
export const Route = createFileRoute('/about')({
  head: () => ({
    meta: [
      { title: `${m.about_title()} · ${m.app_name()}` },
      { name: 'description', content: m.about_description() },
    ],
  }),
  component: AboutPage,
})

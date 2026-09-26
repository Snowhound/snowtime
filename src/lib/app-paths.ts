// The signed-in pages live under the organization's slug: /<slug>/timer, /<slug>/reports,
// and so on (docs/architecture.md, "Tenancy"). The server shares this file.

// The pages under /<slug>/. An old link to one of them, such as /timer, goes to the same page
// in the default organization.
export const APP_PAGES = ['timer', 'reports', 'projects', 'organization', 'settings'] as const
export type AppPage = (typeof APP_PAGES)[number]

export function isAppPage(segment: string): segment is AppPage {
  return (APP_PAGES as readonly string[]).includes(segment)
}

// A slug's form: lowercase words joined by single dashes, as in "northwind-studio". A path
// whose first segment has another form, such as /favicon.ico, names no organization.
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

// Slugs an organization can't take: the top-level paths, which a slug would hide, and the page
// names, which old links read as pages.
export const RESERVED_SLUGS: readonly string[] = [
  ...APP_PAGES,
  'api',
  'sign-in',
  'create-organization',
  'invitation',
  'privacy',
  'terms',
  // The folders in public/.
  'backgrounds',
  'brand',
]

export function isReservedSlug(slug: string) {
  return RESERVED_SLUGS.includes(slug)
}

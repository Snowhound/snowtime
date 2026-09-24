// App icon concepts from design/brand-assets/ (task 029), copied to public/brand/. The choice is
// the appIcon user setting (prototypes/README.md, "App icon"). The concepts are fixed here; a
// deployment could swap them later.
//
// Pages show the concept's bare mark (marks/, a light-page and a dark-page version) with no tile.
// The favicon keeps the tiled icon, on an ice or a navy tile. Hound Hour has both tiles: its
// favicon follows the system theme, as the browser's tab strip does.

const BASE = '/brand'

export const APP_ICON_IDS = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
] as const
export type AppIconId = (typeof APP_ICON_IDS)[number]

// Hound Hour.
export const DEFAULT_APP_ICON: AppIconId = '02'

// Concept names are brand names, the same in every UI language.
export const APP_ICONS: { id: AppIconId; slug: string; name: string; tile: 'ice' | 'navy' }[] = [
  { id: '01', slug: 'frost-clock', name: 'Frost Clock', tile: 'ice' },
  { id: '02', slug: 'hound-hour', name: 'Hound Hour', tile: 'navy' },
  { id: '03', slug: 'peak-time', name: 'Peak Time', tile: 'ice' },
  { id: '04', slug: 'progress-flurry', name: 'Progress Flurry', tile: 'navy' },
  { id: '05', slug: 'snow-s-monogram', name: 'Snow S Monogram', tile: 'navy' },
  { id: '06', slug: 'crystal-time', name: 'Crystal Time', tile: 'ice' },
  { id: '07', slug: 'tracking-together', name: 'Tracking Together', tile: 'navy' },
  { id: '08', slug: 'new-day', name: 'New Day', tile: 'ice' },
  { id: '09', slug: 'st-monogram', name: 'ST Monogram', tile: 'ice' },
  { id: '10', slug: 'north-star', name: 'North Star', tile: 'navy' },
  { id: '11', slug: 'the-trail', name: 'The Trail', tile: 'ice' },
  { id: '12', slug: 'snow-crystal', name: 'Snow Crystal', tile: 'navy' },
]

// Only Hound Hour has light-tile exports and a small mark.
function themed(id: AppIconId) {
  return id === DEFAULT_APP_ICON
}

// The concept for a stored value; an unset or unknown one falls back to Hound Hour.
export function appIcon(id: string | null | undefined) {
  return (
    APP_ICONS.find((icon) => icon.id === id) ??
    APP_ICONS.find((icon) => icon.id === DEFAULT_APP_ICON)!
  )
}

function stem(id: AppIconId) {
  return `${id}-${appIcon(id).slug}`
}

// The bare mark for a light or dark page. The small version (20 to 28 px) differs only for Hound
// Hour; the traced marks read at those sizes as they are.
export function appMarkSrc(id: AppIconId, dark: boolean, small = false) {
  const folder = small && themed(id) ? 'marks-small' : 'marks'
  return `${BASE}/${folder}/${stem(id)}-${dark ? 'dark' : 'light'}.svg`
}

// The tiled browser tab icon, for the picker's badges. Hound Hour's is its navy tile, the group
// the picker lists it in.
export function appTabIconSrc(id: AppIconId) {
  return `${BASE}/icons-small/${stem(id)}.svg`
}

// The favicon links for a concept: 16 and 32 px, and for Hound Hour one pair per system theme.
export function faviconLinks(id: AppIconId) {
  const variants = themed(id)
    ? [
        { suffix: '-light', media: '(prefers-color-scheme: light)' },
        { suffix: '', media: '(prefers-color-scheme: dark)' },
      ]
    : [{ suffix: '', media: undefined }]
  return variants.flatMap(({ suffix, media }) =>
    [16, 32].map((size) => ({
      href: `${BASE}/favicon/variants/${stem(id)}${suffix}-${size}.png`,
      sizes: `${size}x${size}`,
      media,
    })),
  )
}

// Replaces the favicon links in the browser. The server renders the first ones, but Solid doesn't
// hydrate <head>, so a later change of the setting goes through here.
export function setFavicon(id: AppIconId) {
  document.head.querySelectorAll('link[rel="icon"]').forEach((link) => link.remove())
  for (const icon of faviconLinks(id)) {
    const link = Object.assign(document.createElement('link'), {
      rel: 'icon',
      type: 'image/png',
      href: icon.href,
    })
    link.setAttribute('sizes', icon.sizes)
    if (icon.media) link.media = icon.media
    document.head.append(link)
  }
}

// App icon concepts from design/brand-assets/ (task 029) and the browser favicon. The choice is the
// `appIcon` user setting; app-frame.js stores it, and auth.html, which has no frame, reads it here.
// Load in <head> before app-frame.js, so the favicon is set before the page renders.
//
// Inside the app, pages show the bare mark (`marks/`, a light-page and a dark-page version) with no
// tile. The favicon keeps the tiled icon: concept 02 on its navy tile in a dark tab strip and on an
// ice tile (`-light` exports) in a light one. Page images follow the page's theme; the favicon
// follows the system's, which is what the browser's tab strip uses.
;(() => {
  const BASE = '../design/brand-assets/'
  const SETTINGS_KEY = 'snowtime.prototypeSettings'
  const DEFAULT = '02'
  const ICONS = [
    ['01', 'frost-clock', 'Frost Clock'],
    ['02', 'hound-hour', 'Hound Hour'],
    ['03', 'peak-time', 'Peak Time'],
    ['04', 'progress-flurry', 'Progress Flurry'],
    ['05', 'snow-s-monogram', 'Snow S Monogram'],
    ['06', 'crystal-time', 'Crystal Time'],
    ['07', 'tracking-together', 'Tracking Together'],
    ['08', 'new-day', 'New Day'],
    ['09', 'st-monogram', 'ST Monogram'],
    ['10', 'north-star', 'North Star'],
    ['11', 'the-trail', 'The Trail'],
    ['12', 'snow-crystal', 'Snow Crystal'],
  ].map(([id, slug, name]) => ({
    id,
    name,
    stem: `${id}-${slug}`,
    themed: id === '02',
    // The tile the concept is drawn on; 02 has both.
    navy: ['02', '04', '05', '07', '10', '12'].includes(id),
    ice: !['04', '05', '07', '10', '12'].includes(id),
  }))
  const darkQuery = matchMedia('(prefers-color-scheme: dark)')

  const valid = (id) => (ICONS.some((i) => i.id === id) ? id : DEFAULT)
  const find = (id) => ICONS.find((i) => i.id === valid(id))
  const pageIsDark = () => document.documentElement.classList.contains('dark')
  // The export's file stem for the given background.
  function stem(id, dark) {
    const icon = find(id)
    return icon.themed && !dark ? `${icon.stem}-light` : icon.stem
  }
  // The tiled icon. `icons-small/` fills more of the tile and suits the favicon; `icons/` suits 40 px up.
  const src = (id, small = false, dark = pageIsDark()) => `${BASE}${small ? 'icons-small' : 'icons'}/${stem(id, dark)}.svg`
  // The bare mark for a light or dark page. Only 02 has a small version (`marks-small/`, for 20 to
  // 28 px); the traced marks read at those sizes as they are.
  const markSrc = (id, small = false, dark = pageIsDark()) => {
    const icon = find(id)
    return `${BASE}${small && icon.themed ? 'marks-small' : 'marks'}/${icon.stem}-${dark ? 'dark' : 'light'}.svg`
  }

  function saved() {
    try {
      return valid(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').appIcon)
    } catch {
      return DEFAULT
    }
  }

  // Updates the favicon, every bare mark <img data-app-mark>, and every tiled <img data-app-icon>
  // ("small" or "large") on the page. An image with `data-app-icon-id` always shows that concept, in
  // the current theme. Call again when the page's theme changes.
  let current = DEFAULT
  function apply(id = current) {
    current = valid(id)
    const icon = find(id)
    for (const size of [16, 32]) {
      let el = document.head.querySelector(`link[rel="icon"][sizes="${size}x${size}"]`)
      if (!el) {
        el = Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/png' })
        el.setAttribute('sizes', `${size}x${size}`)
        document.head.append(el)
      }
      el.href = `${BASE}favicon/variants/${stem(icon.id, darkQuery.matches)}-${size}.png`
    }
    document.querySelectorAll('img[data-app-mark]').forEach((img) => (img.src = markSrc(img.dataset.appIconId ?? icon.id, img.dataset.appMark === 'small')))
    document.querySelectorAll('img[data-app-icon]').forEach((img) => (img.src = src(img.dataset.appIconId ?? icon.id, img.dataset.appIcon === 'small')))
    document.querySelectorAll('[data-app-icon-name]').forEach((el) => (el.textContent = `${icon.id} ${icon.name}`))
  }

  darkQuery.addEventListener('change', () => apply())

  window.appIcon = { list: ICONS, DEFAULT, valid, find, src, markSrc, saved, apply, SETTINGS_KEY }
  apply(saved())
})()

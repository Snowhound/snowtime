// App frame shared by the signed-in prototypes: header with organization switcher, navigation and
// user menu; a prototype bar with the page's fixture controls and a role switcher; the user's
// settings; the app icon picker; the seasonal scene behind pages that opt in; icons and markup
// helpers. Load after ui.js, app-icon.js, seasons.js, and (for the scene) scene.js, and call
// `appFrame.mount()` first thing in the page script.
;(() => {
  // Lucide icons, copied from lucide-static@1.48.0. Pages can still define their own <symbol>s.
  const ICONS = {
    'archive-restore': '<rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h2" /><path d="M20 8v11a2 2 0 0 1-2 2h-2" /><path d="m9 15 3-3 3 3" /><path d="M12 12v9" />',
    'archive': '<rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" />',
    'building-2': '<path d="M10 12h4" /><path d="M10 8h4" /><path d="M14 21v-3a2 2 0 0 0-4 0v3" /><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" /><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />',
    'calendar': '<path d="M8 2v3" /><path d="M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" />',
    'chart-column': '<path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" />',
    'check': '<path d="M20 6 9 17l-5-5" />',
    'chevron-down': '<path d="m6 9 6 6 6-6" />',
    'chevron-left': '<path d="m15 18-6-6 6-6" />',
    'chevron-right': '<path d="m9 18 6-6-6-6" />',
    'chevrons-up-down': '<path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" />',
    'circle-alert': '<circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" />',
    'clock': '<circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />',
    'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />',
    'crown': '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" />',
    'ellipsis': '<circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />',
    'folder-kanban': '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /><path d="M8 10v4" /><path d="M12 10v2" /><path d="M16 10v6" />',
    'globe': '<circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />',
    'info': '<circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />',
    'key-round': '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /><circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />',
    'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" />',
    'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
    'list-tree': '<path d="M8 5h13" /><path d="M13 12h8" /><path d="M13 19h8" /><path d="M3 10a2 2 0 0 0 2 2h3" /><path d="M3 5v12a2 2 0 0 0 2 2h3" />',
    'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />',
    'log-out': '<path d="m16 17 5-5-5-5" /><path d="M21 12H9" /><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />',
    'mail': '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" /><rect x="2" y="4" width="20" height="16" rx="2" />',
    'monitor': '<rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" />',
    'mountain-snow': '<path d="m8 3 4 8 5-5 5 15H2L8 3z" /><path d="M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19" />',
    'moon': '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />',
    'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />',
    'play': '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />',
    'plus': '<path d="M5 12h14" /><path d="M12 5v14" />',
    'search': '<path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" />',
    'settings': '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" />',
    'shield': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />',
    'square': '<rect width="18" height="18" x="3" y="3" rx="2" />',
    'sun': '<circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />',
    'table-2': '<path d="M3 9h18" /><path d="M9 3v18" /><rect x="3" y="3" width="18" height="18" rx="2" />',
    'timer': '<line x1="10" x2="14" y1="2" y2="2" /><line x1="12" x2="15" y1="14" y2="11" /><circle cx="12" cy="14" r="8" />',
    'trash-2': '<path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
    'user-minus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="22" x2="16" y1="11" y2="11" />',
    'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" x2="19" y1="8" y2="14" /><line x1="22" x2="16" y1="11" y2="11" />',
    'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />',
    'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><path d="M16 3.128a4 4 0 0 1 0 7.744" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><circle cx="9" cy="7" r="4" />',
    'x': '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const icon = (name, cls = '') => `<svg class="prototype-icon ${cls}" aria-hidden="true"><use href="#icon-${name}" /></svg>`
  const initials = (name) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('')

  // --- User settings -------------------------------------------------------------------------
  // The app keeps these in user_settings. The prototypes stand in for it with one localStorage key,
  // so every page sees the same values. The Settings page, the timer's View popover and the user
  // menu's theme items all read and write it through here, and each change saves right away.
  const SETTINGS_KEY = 'snowtime.prototypeSettings'
  const SETTINGS_DEFAULTS = {
    locale: 'en',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weekStart: 'mon',
    theme: 'system',
    design: 'bar', // user_settings.timer_layout
    showSummary: true,
    surfaces: 'glass', // 'glass' | 'solid': whether cards let a background show through
    // The seasonal scene behind the sign-in page and the app; see scene.js. The season also picks
    // every page's tagline.
    sceneSeason: 'auto', // 'auto' (by month) | 'winter' | 'spring' | 'summer' | 'autumn'
    sceneBackground: true,
    sceneStrength: 'full', // 'full' | 'dimmed'
    sceneWeather: true,
    sceneIntro: true, // play the intro on the first visit
    appIcon: appIcon.DEFAULT, // '01' to '12', see app-icon.js
  }
  const darkQuery = matchMedia('(prefers-color-scheme: dark)')
  const readSettings = () => {
    try {
      const stored = { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }
      return { ...stored, appIcon: appIcon.valid(stored.appIcon) }
    } catch {
      return { ...SETTINGS_DEFAULTS }
    }
  }
  let settings = readSettings()
  const listeners = { role: [], org: [], settings: [] }
  const emit = (type) => listeners[type].forEach((fn) => fn())

  function applyAppIcon() {
    appIcon.apply(settings.appIcon)
    // Each group of the picker is its own radio group, with one option in the tab order: the
    // chosen one, or the group's first.
    document.querySelectorAll('#app-icon-dialog [role="radiogroup"]').forEach((group) => {
      const options = [...group.querySelectorAll('[data-app-icon-option]')]
      const tabbable = options.find((b) => b.dataset.appIconOption === settings.appIcon) ?? options[0]
      options.forEach((b) => {
        b.setAttribute('aria-checked', String(b.dataset.appIconOption === settings.appIcon))
        b.tabIndex = b === tabbable ? 0 : -1
      })
    })
  }
  function applyTheme() {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark' || (settings.theme === 'system' && darkQuery.matches))
    document.querySelectorAll('[data-frame-theme]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.frameTheme === settings.theme)))
    appIcon.apply(settings.appIcon) // the marks follow the theme
  }
  const settingsStore = {
    get: () => ({ ...settings }),
    set(patch) {
      settings = { ...settings, ...patch }
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      } catch {}
      applyTheme()
      applyAppIcon()
      emit('settings')
    },
    reset() {
      try {
        localStorage.removeItem(SETTINGS_KEY)
      } catch {}
      settings = { ...SETTINGS_DEFAULTS }
      applyTheme()
      applyAppIcon()
      emit('settings')
    },
  }
  darkQuery.addEventListener('change', () => settings.theme === 'system' && applyTheme())
  // Another tab changed the settings.
  addEventListener('storage', (event) => {
    if (event.key !== SETTINGS_KEY) return
    settings = readSettings()
    applyTheme()
    applyAppIcon()
    emit('settings')
  })
  applyTheme()

  // --- Session (prototype) -------------------------------------------------------------------
  // The signed-in user, their organizations, and a prototype-only role. Role and organization are
  // kept in the URL (?role=, ?org=) so they survive navigating between prototypes.
  const user = { id: 'u-anna', name: 'Anna Kask', email: 'anna@snowhound.eu' }
  const organizations = [
    { id: 'snowhound', name: 'Snowhound' },
    { id: 'lumi', name: 'Lumi Design Collective' },
    { id: 'pohjala', name: 'Põhjamaade Logistika- ja Laohaldusteenuste Konsortsium OÜ' },
  ]
  const ROLES = [
    { id: 'member', label: 'Member' },
    { id: 'lead', label: 'Team lead' },
    { id: 'admin', label: 'Admin' },
    { id: 'owner', label: 'Owner' },
  ]
  const params = new URLSearchParams(location.search)
  let role = ROLES.some((r) => r.id === params.get('role')) ? params.get('role') : 'admin'
  let orgId = organizations.some((o) => o.id === params.get('org')) ? params.get('org') : 'snowhound'

  const NAV = [
    { page: 'timer', href: 'timer.html', label: 'Timer', icon: 'timer' },
    { page: 'reports', href: 'reports.html', label: 'Reports', icon: 'chart-column' },
    { page: 'projects', href: 'projects.html', label: 'Projects', icon: 'folder-kanban' },
    { page: 'organization', href: 'organization.html', label: 'Organization', icon: 'building-2', admin: true },
  ]
  const isAdmin = () => role === 'admin' || role === 'owner'
  // Links keep the prototype role and organization; a hash (e.g. #profile) stays at the end.
  const link = (href) => {
    const [path, hash] = href.split('#')
    const q = new URLSearchParams({ role, org: orgId })
    return `${path}?${q}${hash ? `#${hash}` : ''}`
  }

  let currentPage = ''
  let sceneCtl = null

  function orgMark(org, cls = 'size-6 text-xs') {
    return `<span class="flex ${cls} shrink-0 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground" aria-hidden="true">${escapeHtml(org.name[0])}</span>`
  }

  // The chosen concept's bare mark for the page's theme, fitted into a square. Tiles are only for
  // the favicon and the picker's badges.
  function appIconImg(size, cls) {
    return `<img data-app-mark="${size}" src="${appIcon.markSrc(settings.appIcon, size === 'small')}" alt="" class="${cls} shrink-0 object-contain" />`
  }

  // --- App icon picker -----------------------------------------------------------------------
  // Two radio groups in a modal dialog, opened from the header mark and from Settings. Each option
  // shows the bare mark for the page's theme, with the tiled favicon as a badge; the groups are the
  // favicon's tile, light or navy. Hound Hour has both tiles (its favicon follows the system theme)
  // but is listed once, with the navy concepts. A choice saves right away, like the other settings.
  function renderIconDialog() {
    const groups = [
      { id: 'light', label: 'Light tab icons', dark: false, icons: appIcon.list.filter((i) => i.ice && !i.themed) },
      { id: 'navy', label: 'Navy tab icons', dark: true, icons: appIcon.list.filter((i) => i.navy) },
    ]
    const option = (i, dark) => `<button type="button" role="radio" data-app-icon-option="${i.id}" aria-checked="false" tabindex="-1"
        class="group relative flex flex-col items-center gap-1.5 rounded-lg border border-transparent px-1 py-2 text-center text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:border-primary aria-checked:bg-accent sm:gap-2 sm:p-3 sm:text-sm">
        <span class="absolute right-1 top-1 hidden size-5 items-center justify-center rounded-full bg-primary text-primary-foreground group-aria-checked:flex">${icon('check', 'size-3')}</span>
        <span class="relative">
          <img data-app-mark="large" data-app-icon-id="${i.id}" src="${appIcon.markSrc(i.id)}" alt="" class="size-11 object-contain sm:size-14" />
          <img src="${appIcon.src(i.id, true, dark)}" alt="" title="Browser tab icon" class="absolute -bottom-1 -right-2 size-5 rounded-[22.5%] shadow-sm ring-1 ring-border" />
        </span>
        <span class="flex flex-col leading-tight"><span class="text-xs tabular-nums text-muted-foreground">${i.id}</span><span class="font-medium">${i.name}</span></span>
        ${i.id === appIcon.DEFAULT ? '<span data-ui="badge" data-variant="secondary" class="px-1.5 py-0 text-[10px]">Default</span>' : ''}
      </button>`
    document.body.insertAdjacentHTML(
      'beforeend',
      `<dialog id="app-icon-dialog" data-ui="dialog" class="max-w-3xl" aria-labelledby="app-icon-title" aria-describedby="app-icon-description">
        <div data-ui="dialog-header">
          <h2 id="app-icon-title" data-ui="dialog-title">App icon</h2>
          <p id="app-icon-description" data-ui="dialog-description">The mark shows in the app. The small tile is the browser tab icon, grouped by its tile. Hound Hour's tab icon follows your system's light or dark theme. Your choice saves right away.</p>
        </div>
        ${groups
          .map(
            (g) => `<div class="grid gap-2">
              <h3 id="app-icon-group-${g.id}" class="text-sm font-medium">${g.label}</h3>
              <div role="radiogroup" aria-labelledby="app-icon-group-${g.id}" class="grid grid-cols-3 gap-1 sm:grid-cols-6 sm:gap-2">${g.icons.map((i) => option(i, g.dark)).join('')}</div>
            </div>`
          )
          .join('')}
        <div data-ui="dialog-footer">
          <button type="button" data-ui="button" data-dialog-cancel>Done</button>
        </div>
        <button type="button" data-ui="dialog-close" data-dialog-cancel>${icon('x')}<span class="sr-only">Close</span></button>
      </dialog>`
    )
    const dialog = document.getElementById('app-icon-dialog')
    applyAppIcon()
    const choose = (b) => {
      b.focus()
      if (b.dataset.appIconOption !== settings.appIcon) settingsStore.set({ appIcon: b.dataset.appIconOption })
    }
    dialog.addEventListener('click', (event) => {
      const option = event.target.closest('[data-app-icon-option]')
      if (option) choose(option)
      else if (event.target.closest('[data-dialog-cancel]')) dialog.close()
      else if (event.target === dialog) {
        // A click on the backdrop lands on the dialog itself, outside its box.
        const r = dialog.getBoundingClientRect()
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close()
      }
    })
    // Arrow keys move through a group's grid and choose, as in a radio group; Home and End jump.
    dialog.addEventListener('keydown', (event) => {
      const group = event.target.closest?.('[role="radiogroup"]')
      if (!group) return
      const options = [...group.querySelectorAll('[data-app-icon-option]')]
      const i = options.indexOf(event.target)
      const columns = options.filter((b) => b.offsetTop === options[0].offsetTop).length
      const next = { ArrowLeft: i - 1, ArrowRight: i + 1, ArrowUp: i - columns, ArrowDown: i + columns, Home: 0, End: options.length - 1 }[event.key]
      if (next === undefined) return
      event.preventDefault()
      choose(options[(next + options.length) % options.length])
    })
  }

  // Opens the picker; closing it returns focus to the control that opened it.
  function openIconPicker() {
    const dialog = document.getElementById('app-icon-dialog')
    const opener = document.activeElement
    dialog.addEventListener('close', () => opener?.isConnected && opener.focus(), { once: true })
    dialog.showModal()
    dialog.querySelector('[aria-checked="true"]').focus()
  }

  function navLinks(mobile) {
    return NAV.filter((n) => !n.admin || isAdmin())
      .map((n) => {
        const current = n.page === currentPage
        return `<a href="${link(n.href)}" data-ui="button" data-variant="${current ? 'secondary' : 'ghost'}" data-size="sm" data-frame-link="${n.href}"
          class="${mobile ? 'h-9 flex-1 gap-1.5 px-2' : ''}"${current ? ' aria-current="page"' : ''}>${icon(n.icon)}${n.label}</a>`
      })
      .join('')
  }

  function renderHeader() {
    const org = organizations.find((o) => o.id === orgId)
    const header = document.getElementById('app-header')
    header.innerHTML = `
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4 sm:gap-2 sm:px-8">
        <button type="button" data-frame-app-icon class="mr-1 flex shrink-0 items-center gap-2 rounded-md text-base font-bold tracking-[-0.02em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-haspopup="dialog" aria-label="Snowtime: change app icon" title="Change app icon">
          ${appIconImg('small', 'size-7')}<span class="hidden sm:inline md:hidden lg:inline">Snowtime</span>
        </button>
        <span class="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true"></span>
        <button type="button" data-ui="button" data-variant="ghost" data-size="sm" class="min-w-0 max-w-[13rem] justify-start gap-2 px-2 lg:max-w-[16rem]"
          popovertarget="org-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Organization: ${escapeHtml(org.name)}">
          ${orgMark(org)}<span class="truncate text-sm">${escapeHtml(org.name)}</span>${icon('chevrons-up-down', 'opacity-50')}
        </button>
        <div id="org-menu" popover data-ui="menu" data-align="start" class="w-64" role="menu" aria-label="Organizations">
          <div data-ui="menu-label" class="text-xs font-medium text-muted-foreground">Organizations</div>
          ${organizations
            .map(
              (o) => `<button type="button" role="menuitemradio" data-ui="menu-radio-item" data-frame-org="${o.id}" aria-checked="${o.id === orgId}" class="gap-2">
                ${orgMark(o, 'size-5 text-[10px]')}<span class="min-w-0 truncate">${escapeHtml(o.name)}</span></button>`
            )
            .join('')}
          <div data-ui="menu-separator" role="separator"></div>
          <button type="button" role="menuitem" data-ui="menu-item" disabled>${icon('plus')}Create organization</button>
        </div>
        <nav class="ml-2 hidden items-center gap-1 md:flex" aria-label="Main">${navLinks(false)}</nav>
        ${
          sceneCtl
            ? `<button type="button" data-ui="button" data-variant="ghost" data-size="icon" class="ml-auto size-9 shrink-0" popovertarget="scene-menu" aria-haspopup="dialog" aria-expanded="false" aria-label="Scenery" title="Scenery">${icon('mountain-snow')}</button>`
            : ''
        }
        <button type="button" class="${sceneCtl ? 'ml-1' : 'ml-auto'} shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          popovertarget="user-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu for ${escapeHtml(user.name)}">
          <span data-ui="avatar" class="size-8"><span data-ui="avatar-fallback" class="text-xs font-medium">${escapeHtml(initials(user.name))}</span></span>
        </button>
        <div id="user-menu" popover data-ui="menu" class="w-60" role="menu" aria-label="Account">
          <div data-ui="menu-label" class="flex flex-col gap-0.5 font-normal">
            <span class="truncate text-sm font-medium">${escapeHtml(user.name)}</span>
            <span class="truncate text-xs text-muted-foreground">${escapeHtml(user.email)}</span>
          </div>
          <div data-ui="menu-separator" role="separator"></div>
          <a href="${link('settings.html#profile')}" data-frame-link="settings.html#profile" role="menuitem" data-ui="menu-item">${icon('user')}Profile</a>
          <a href="${link('settings.html')}" data-frame-link="settings.html" role="menuitem" data-ui="menu-item">${icon('settings')}Settings</a>
          <div data-ui="menu-separator" role="separator"></div>
          <div data-ui="menu-label" class="text-xs font-medium text-muted-foreground" id="user-menu-theme">Theme</div>
          <div role="group" aria-labelledby="user-menu-theme">
            ${[
              ['light', 'Light', 'sun'],
              ['dark', 'Dark', 'moon'],
              ['system', 'System', 'monitor'],
            ]
              .map(
                ([value, label, i]) =>
                  `<button type="button" role="menuitemradio" data-ui="menu-radio-item" data-frame-theme="${value}" aria-checked="${settings.theme === value}" class="gap-2">${icon(i)}${label}</button>`
              )
              .join('')}
          </div>
          <div data-ui="menu-separator" role="separator"></div>
          <a href="auth.html" role="menuitem" data-ui="menu-item">${icon('log-out')}Sign out</a>
        </div>
      </div>
      <nav class="flex gap-1 border-t px-2 py-1.5 md:hidden" aria-label="Main">${navLinks(true)}</nav>`
  }

  function renderBar(title) {
    const bar = document.getElementById('prototype-bar')
    bar.innerHTML = `
      <div class="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex items-baseline gap-2">
          <span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Snowtime prototype</span>
          <span class="text-sm font-medium">${escapeHtml(title)}</span>
        </div>
        <div class="flex flex-wrap items-center gap-2" id="prototype-bar-controls">
          <label for="frame-role" class="sr-only">Role (prototype)</label>
          <select id="frame-role" data-ui="select" class="h-9 w-36" title="Prototype only: the signed-in user's role">
            ${ROLES.map((r) => `<option value="${r.id}"${r.id === role ? ' selected' : ''}>As ${r.label.toLowerCase()}</option>`).join('')}
          </select>
        </div>
      </div>`
  }

  // Keep the URL and every frame link in step with the role and organization.
  function syncLinks() {
    history.replaceState(null, '', link(location.pathname.split('/').pop() + location.hash))
    document.querySelectorAll('[data-frame-link]').forEach((a) => (a.href = link(a.dataset.frameLink)))
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-frame-app-icon]')) return openIconPicker()
    const orgItem = event.target.closest('[data-frame-org]')
    const themeItem = event.target.closest('[data-frame-theme]')
    if (orgItem && orgItem.dataset.frameOrg !== orgId) {
      orgId = orgItem.dataset.frameOrg
      renderHeader()
      syncLinks()
      emit('org')
    } else if (themeItem) settingsStore.set({ theme: themeItem.dataset.frameTheme })
  })

  // `scene: true` puts the seasonal scene behind the page and a Scenery button in the header.
  function mount({ page, title, scene: withScene = false }) {
    currentPage = page
    if (withScene && window.scene) mountScene()
    const sprite = `<svg aria-hidden="true" style="position: absolute; width: 0; height: 0; overflow: hidden"><defs>${Object.entries(ICONS)
      .map(([name, body]) => `<symbol id="icon-${name}" viewBox="0 0 24 24">${body}</symbol>`)
      .join('')}</defs></svg>`
    document.body.insertAdjacentHTML(
      'afterbegin',
      `${sprite}<div id="prototype-bar" class="border-b border-dashed bg-muted/60"></div><header id="app-header" class="border-b bg-background"></header>`
    )
    renderBar(title)
    renderHeader()
    renderIconDialog()
    renderTagline()
    if (sceneCtl) renderSceneMenu()
    // The page's own prototype controls (fixtures, variants) move into the bar, before the role.
    const controls = document.getElementById('prototype-controls')
    if (controls) document.getElementById('prototype-bar-controls').prepend(...controls.children)
    controls?.remove()
    document.getElementById('frame-role').addEventListener('change', (event) => {
      role = event.currentTarget.value
      renderHeader()
      syncLinks()
      emit('role')
    })
    syncLinks()
  }

  // --- Seasonal scene --------------------------------------------------------------------------
  // The sign-in page's scene (scene.js) behind the page: the season's image, the tint, and the
  // weather, from the same user settings. Cards follow the Surfaces setting through CSS on the body's
  // data attributes (prototype.css). The weather's pace on app pages is a prototype variant.
  const SCENE_VARIANTS_KEY = 'snowtime.prototypeAppScene'
  const PACES = {
    calm: { label: 'Weather: calm', density: 0.5, speed: 0.7 },
    'sign-in': { label: 'Weather: as sign-in', density: 1, speed: 1 },
  }
  function scenePace() {
    try {
      const pace = JSON.parse(localStorage.getItem(SCENE_VARIANTS_KEY) ?? '{}').pace
      return pace in PACES ? pace : 'calm'
    } catch {
      return 'calm'
    }
  }

  function mountScene() {
    const { density, speed } = PACES[scenePace()]
    sceneCtl = scene.create({ season: seasons.current(), pace: { density, speed } })
    const holder = document.createElement('div')
    holder.className = 'app-scene'
    holder.append(sceneCtl.el)
    document.body.prepend(holder)
    document.body.dataset.scene = 'on'
    applyScene()
    listeners.settings.push(applyScene)
    // The weather switch and hint say when reduced motion keeps the weather off.
    scene.reducedMotion.addEventListener('change', applyScene)
  }

  function applyScene() {
    sceneCtl.set({ season: seasons.current(), strength: settings.sceneStrength, background: settings.sceneBackground, weather: settings.sceneWeather })
    document.body.dataset.sceneBg = settings.sceneBackground ? 'on' : 'off'
    document.body.dataset.surfaces = settings.surfaces
    const menu = document.getElementById('scene-menu')
    if (!menu) return
    ui.setSwitch(document.getElementById('scene-bg-switch'), settings.sceneBackground)
    menu.querySelectorAll('[data-scene-option]').forEach((b) => {
      const pressed = b.dataset.value === settings[b.dataset.sceneOption]
      b.setAttribute('aria-pressed', String(pressed))
      b.toggleAttribute('data-pressed', pressed)
      b.disabled = !settings.sceneBackground
    })
    const blocked = sceneCtl.weatherBlocked()
    const weatherSwitch = document.getElementById('scene-weather-switch')
    ui.setSwitch(weatherSwitch, settings.sceneWeather)
    weatherSwitch.disabled = !!blocked
    document.getElementById('scene-weather-hint').textContent = blocked ?? scene.SEASONS[seasons.current()].hint
    const seasonSelect = document.getElementById('scene-season')
    seasonSelect.value = seasons.chosen()
    seasonSelect.options[0].textContent = `Auto (${seasons.SEASONS[seasons.byMonth()].label.toLowerCase()})`
  }

  // The Scenery popover, opened from the header's mountain button: the sign-in page's menu without
  // the intro, which only plays there. It sits outside the header, which re-renders.
  function renderSceneMenu() {
    const row = (label, hint, control, indent = false) => `<div class="flex items-center justify-between gap-4${indent ? ' pl-3' : ''}">
        <div class="grid gap-0.5">${label}<span class="text-xs text-muted-foreground"${hint.id ? ` id="${hint.id}"` : ''}>${hint.text ?? ''}</span></div>
        ${control}
      </div>`
    const toggles = (key, labelId, options) => `<div data-ui="toggle-group" class="shrink-0" role="group" aria-labelledby="${labelId}">
        ${options.map(([value, label]) => `<button type="button" data-ui="toggle" data-variant="outline" data-size="sm" data-scene-option="${key}" data-value="${value}">${label}</button>`).join('')}
      </div>`
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div id="scene-menu" popover data-ui="popover" class="grid w-80 gap-4" role="dialog" aria-labelledby="scene-menu-title">
        <h2 id="scene-menu-title" class="text-sm font-semibold">Scenery</h2>
        ${row(
          '<label data-ui="label" for="scene-season">Season</label>',
          { text: 'The landscape, weather, and taglines.' },
          `<div class="shrink-0"><select id="scene-season" data-ui="select" class="h-9 w-36">
            <option value="auto">Auto</option>${Object.entries(seasons.SEASONS)
              .map(([id, s]) => `<option value="${id}">${s.label}</option>`)
              .join('')}
          </select></div>`
        )}
        ${row(
          '<span data-ui="label" id="scene-bg-label">Background</span>',
          { text: 'A landscape for the season.' },
          '<button type="button" id="scene-bg-switch" role="switch" aria-checked="true" aria-labelledby="scene-bg-label" data-ui="switch"><span data-ui="switch-thumb"></span></button>'
        )}
        ${row(
          '<span data-ui="label" id="scene-strength-label">Strength</span>',
          { text: 'How much the page color covers it.' },
          toggles('sceneStrength', 'scene-strength-label', [
            ['full', 'Full'],
            ['dimmed', 'Dimmed'],
          ]),
          true
        )}
        ${row(
          '<span data-ui="label" id="surfaces-label">Surfaces</span>',
          { text: 'Glass lets it show through cards.' },
          toggles('surfaces', 'surfaces-label', [
            ['glass', 'Glass'],
            ['solid', 'Solid'],
          ]),
          true
        )}
        ${row(
          '<span data-ui="label" id="scene-weather-label">Weather</span>',
          { id: 'scene-weather-hint' },
          '<button type="button" id="scene-weather-switch" role="switch" aria-checked="true" aria-labelledby="scene-weather-label" aria-describedby="scene-weather-hint" data-ui="switch"><span data-ui="switch-thumb"></span></button>'
        )}
        <div data-ui="separator"></div>
        <a href="${link('settings.html#scenery')}" data-frame-link="settings.html#scenery" data-ui="button" data-variant="link" data-size="sm" class="h-auto justify-start p-0">All scenery settings</a>
      </div>`
    )
    const menu = document.getElementById('scene-menu')
    menu.querySelector('#scene-season').addEventListener('change', (event) => settingsStore.set({ sceneSeason: event.currentTarget.value }))
    menu.querySelector('#scene-bg-switch').addEventListener('change', (event) => settingsStore.set({ sceneBackground: event.currentTarget.getAttribute('aria-checked') === 'true' }))
    menu.querySelector('#scene-weather-switch').addEventListener('change', (event) => settingsStore.set({ sceneWeather: event.currentTarget.getAttribute('aria-checked') === 'true' }))
    menu.querySelectorAll('[data-scene-option]').forEach((b) => b.addEventListener('click', () => settingsStore.set({ [b.dataset.sceneOption]: b.dataset.value })))

    // Prototype variant: the weather's pace on app pages. Changing it reloads the scene.
    document.getElementById('prototype-bar-controls').insertAdjacentHTML(
      'afterbegin',
      `<label for="scene-pace" class="sr-only">Weather pace (prototype)</label>
      <select id="scene-pace" data-ui="select" class="h-9 w-48" title="Prototype only: the weather's density and speed on app pages">
        ${Object.entries(PACES)
          .map(([id, p]) => `<option value="${id}"${id === scenePace() ? ' selected' : ''}>${p.label}</option>`)
          .join('')}
      </select>`
    )
    document.getElementById('scene-pace').addEventListener('change', (event) => {
      try {
        localStorage.setItem(SCENE_VARIANTS_KEY, JSON.stringify({ pace: event.currentTarget.value }))
      } catch {}
      const { density, speed } = PACES[event.currentTarget.value]
      sceneCtl.set({ pace: { density, speed } })
    })
    applyScene()
  }

  // The season's tagline (seasons.js) at the foot of every page, over a fade into a deeper tint. On a
  // short page, `sticky` with a top offset of the viewport minus its height moves it down to the
  // bottom of the full-height body; a flex column would shrink the pages' `mx-auto` blocks.
  function renderTagline() {
    const main = document.querySelector('body > main')
    if (!main || !window.seasons) return
    document.body.classList.add('min-h-dvh')
    main.insertAdjacentHTML(
      'afterend',
      `<p id="page-tagline" class="pointer-events-none sticky top-[calc(100dvh-5.5rem)] h-[5.5rem] px-4 pb-5 pt-12 text-center text-sm text-muted-foreground"></p>`
    )
    const update = () => (document.getElementById('page-tagline').textContent = seasons.tagline())
    update()
    listeners.settings.push(update)
  }

  // Fixtures can swap in another user, e.g. a long name, to check the header.
  function setUser(next) {
    Object.assign(user, next)
    renderHeader()
    syncLinks()
  }

  window.appFrame = {
    mount,
    setUser,
    on: (type, fn) => listeners[type].push(fn),
    settings: settingsStore,
    user,
    organizations,
    get role() {
      return role
    },
    get org() {
      return organizations.find((o) => o.id === orgId)
    },
    isAdmin,
    openIconPicker,
    appIconImg,
    link,
    escapeHtml,
    icon,
    initials,
  }
})()

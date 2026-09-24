// The seasonal intro (task 031), shared by the sign-in page and the signed-in pages (task 032):
// about 13 seconds, always dark, over the page's scene (scene.js). It opens on the weather alone,
// shows the season's lines from seasons.js, fades the background in, then hands back to the page,
// which rises into place in its own theme. Load after seasons.js and scene.js.
//
// Memory, in localStorage beside the settings: `snowtime.introSeen` (the sign-in page plays it on
// the first visit) and `snowtime.introSeason` (the season by month it last played in; app pages
// play it once when that changes). Both follow the `sceneIntro` setting, and it never plays with
// reduced motion.
//
// `intro.create({ scene, page, signedIn, onChange, restoreTheme })` returns a player. While it
// plays, the page applies its scene through `player.scene(patch)`, which shows the weather and the
// intro's background whatever the user's switches say, and re-applies it on `onChange`.
;(() => {
  const SEEN_KEY = 'snowtime.introSeen'
  const SEASON_KEY = 'snowtime.introSeason'
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

  function read(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {}
  }
  function markSeen() {
    write(SEEN_KEY, '1')
    write(SEASON_KEY, seasons.byMonth())
  }
  function allowed() {
    return !reducedMotion.matches && scene.settings.get().sceneIntro
  }
  // Whether it plays on this visit: 'sign-in' on the first visit to this browser, 'app' on the
  // first page opened in a season it hasn't played in.
  function due(where) {
    if (!allowed()) return false
    return where === 'app' ? read(SEASON_KEY) !== seasons.byMonth() : read(SEEN_KEY) !== '1'
  }
  // Paints the page black until the intro starts, so a light page doesn't flash first. Call it from
  // <head> or before the body renders.
  function hold() {
    document.documentElement.classList.add('intro-pending')
  }

  const style = document.createElement('style')
  style.textContent = `
    html.intro-pending { background: #05070a; }
    html.intro-pending body { visibility: hidden; }
    .intro { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; transition: opacity 1.05s ease;
      background: linear-gradient(180deg, rgb(0 0 0 / .4), rgb(0 0 0 / .28)); }
    .intro[hidden] { display: none; }
    .intro.intro-done { opacity: 0; pointer-events: none; }
    .intro-fade { position: absolute; inset: 0; background: #05070a; transition: opacity 1.1s ease; }
    .intro-fade.reveal { opacity: 0; }
    .intro-block { position: relative; width: min(760px, calc(100vw - 48px)); text-align: center; transform: translateY(-16px); }
    .intro-line { margin: 0; opacity: 0; transform: translateY(16px); filter: blur(10px); text-wrap: balance;
      transition: opacity .85s ease, transform .85s ease, filter .85s ease; text-shadow: 0 4px 28px rgb(0 0 0 / .45); }
    .intro-line.show { opacity: 1; transform: none; filter: none; }
    .intro-line-1 { font-size: clamp(34px, 5vw, 58px); line-height: 1.05; letter-spacing: -.04em; font-weight: 720; color: var(--intro-title, #f4f8fd); }
    .intro-line-2 { margin-top: 8px; font-size: clamp(22px, 3vw, 36px); line-height: 1.12; letter-spacing: -.03em; font-weight: 610; color: var(--intro-sub, #e6eef8); }
    .intro-line-3 { margin-top: 24px; font-size: clamp(14px, 1.65vw, 19px); line-height: 1.52; font-weight: 450; color: rgb(255 255 255 / .78); }
    .intro-line-4 { margin-top: 12px; transition-duration: 1.2s; font-size: clamp(13px, 1.45vw, 16px); line-height: 1.5; letter-spacing: .03em;
      text-transform: uppercase; color: var(--intro-accent, #b4d5f4); }
    .intro-skip { position: absolute; top: 18px; right: 18px; }
    /* The page waits under the intro, then rises into place. The class is only there while the
       intro runs, so it doesn't override the page's own transitions. */
    .intro-page { transition: opacity .95s ease, transform .95s cubic-bezier(.2, .72, .2, 1), filter .95s ease; }
    body[data-intro] .intro-page { opacity: 0; transform: translateY(18px) scale(.988); filter: blur(12px); }
    /* The background fades in slowly during the intro. */
    body[data-intro] .scene-photo { transition-duration: 2.6s; }
    /* At the start the image, the page, and the theme change at once: fading them out let the image
       show as the black lifted. */
    .intro-cut :is(.scene, .scene *, .intro-page) { transition: none !important; }
  `
  document.head.append(style)

  // `page()` returns the elements the intro hides and makes inert. `restoreTheme(wasDark)` puts the
  // page's theme back as the intro hands over; by default the dark class returns to what it was.
  function create({ scene: sceneCtl, page, signedIn = false, onChange = () => {}, restoreTheme }) {
    const el = document.createElement('section')
    el.className = 'intro'
    el.setAttribute('aria-label', 'Intro')
    el.hidden = true
    el.innerHTML = `<div class="intro-fade"></div>
      <div class="intro-block">${[1, 2, 3, 4].map((n) => `<p class="intro-line intro-line-${n}"></p>`).join('')}</div>
      <button type="button" data-ui="button" data-variant="outline" data-size="sm" class="intro-skip border-white/20 bg-black/40 text-white backdrop-blur hover:bg-black/60 hover:text-white">Skip intro</button>`
    document.body.append(el)
    const fade = el.querySelector('.intro-fade')
    const lines = [...el.querySelectorAll('.intro-line')]
    const skipButton = el.querySelector('.intro-skip')

    let timers = []
    let playing = false
    let darkHeld = false
    let background = false
    let wasDark = false
    let pageEls = []
    let returnFocus = null

    function clear() {
      timers.forEach(clearTimeout)
      timers = []
    }
    function setBackground(on) {
      background = on
      onChange()
    }
    function releaseTheme() {
      darkHeld = false
      if (restoreTheme) restoreTheme(wasDark)
      else document.documentElement.classList.toggle('dark', wasDark)
    }
    function revealPage() {
      playing = false
      delete document.body.dataset.intro
      pageEls.forEach((p) => (p.inert = false))
      onChange()
    }
    function end() {
      el.hidden = true
      pageEls.forEach((p) => p.classList.remove('intro-page'))
      pageEls = []
      markSeen()
    }
    function handFocus() {
      if (el.contains(document.activeElement) || document.activeElement === document.body) {
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
        else document.activeElement.blur()
      }
    }

    // Returns false when it can't play: with reduced motion, or with no scene to play over.
    function play({ focus } = {}) {
      if (reducedMotion.matches || !sceneCtl) {
        document.documentElement.classList.remove('intro-pending')
        return false
      }
      clear()
      returnFocus = focus ?? null
      if (!darkHeld) wasDark = document.documentElement.classList.contains('dark')
      const season = seasons.current()
      seasons.introLines(season, signedIn).forEach((line, i) => (lines[i].textContent = line))
      for (const [name, color] of Object.entries(seasons.SEASONS[season].colors)) el.style.setProperty(`--intro-${name}`, color)

      pageEls.forEach((p) => p.classList.remove('intro-page'))
      pageEls = page()
      document.documentElement.classList.add('intro-cut', 'dark')
      pageEls.forEach((p) => {
        p.classList.add('intro-page')
        p.inert = true
      })
      playing = true
      darkHeld = true
      document.body.dataset.intro = 'playing'
      setBackground(false)
      sceneCtl.preload('dark')
      el.hidden = false
      el.classList.remove('intro-done')
      fade.classList.remove('reveal')
      lines.forEach((l) => l.classList.remove('show'))
      getComputedStyle(document.body).opacity
      document.documentElement.classList.remove('intro-cut', 'intro-pending')
      skipButton.focus()

      const at = (ms, fn) => timers.push(setTimeout(fn, ms))
      // The weather alone, the first line, a pause, the background fades in, a pause, then the
      // other lines, each after the one before has had time to be read. The last one gets a longer
      // beat before it and stays longest.
      at(300, () => fade.classList.add('reveal'))
      ;[1900, 5400, 7700, 10200].forEach((ms, i) => at(ms, () => lines[i].classList.add('show')))
      at(3100, () => setBackground(true))
      at(13300, revealPage)
      at(13500, () => el.classList.add('intro-done'))
      at(13850, () => {
        releaseTheme()
        handFocus()
      })
      at(14950, end)
      return true
    }
    function skip() {
      if (!playing) return
      clear()
      fade.classList.add('reveal')
      el.classList.add('intro-done')
      releaseTheme()
      revealPage()
      handFocus()
      timers.push(setTimeout(end, 1100))
      markSeen()
    }
    skipButton.addEventListener('click', skip)
    addEventListener('keydown', (event) => event.key === 'Escape' && skip())

    return {
      play,
      skip,
      playing: () => playing,
      // Whether the intro keeps the page dark; a page re-applying its theme keeps it dark meanwhile.
      holdsDark: () => darkHeld,
      // The scene as the page should show it: while the intro plays, always the weather, and the
      // background only once it has faded in.
      scene: (patch) => (playing ? { ...patch, background, weather: true } : patch),
    }
  }

  window.intro = { create, due, hold, markSeen, reducedMotion }
})()

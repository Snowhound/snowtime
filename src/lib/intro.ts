// The seasonal intro (prototypes/intro.js, prototypes/README.md, "Seasonal scene and intro"):
// about 13 seconds, always dark, over the page's scene. It opens on the weather alone, shows the
// season's lines (src/lib/seasons.ts), fades the background in, then hands back to the page,
// which rises into place in its own theme. The page stays mounted under it, so a running timer
// keeps counting. src/components/intro.tsx renders it from the state here.
//
// It plays on the sign-in page on the first visit to this browser (`snowtime.introSeen`) and on
// the first signed-in page opened in a calendar season it hasn't played in
// (`snowtime.introSeason`), under the Intro switch and never with reduced motion. Replay plays it
// any time. While it plays, <html data-intro> holds the page dark: the theme script
// (src/lib/session.ts) treats it as dark.
import { createSignal } from 'solid-js'
import { type Season, type SceneSettings, seasonByMonth } from './scene'
import { introLines } from './seasons'

export const INTRO_SEEN_KEY = 'snowtime.introSeen'
export const INTRO_SEASON_KEY = 'snowtime.introSeason'

// How long the head script's black page waits for the intro before giving up, in case the page
// never mounts.
export const INTRO_PENDING_TIMEOUT = 8000

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage is blocked: the intro may play again.
  }
}

function markSeen() {
  write(INTRO_SEEN_KEY, '1')
  write(INTRO_SEASON_KEY, seasonByMonth())
}

function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Whether it plays on its own on this visit. It keys on the calendar season, not the Season
// setting, so changing that setting doesn't queue an intro.
export function introDue(where: 'sign-in' | 'app', sceneIntro: boolean) {
  if (!sceneIntro || reducedMotion()) return false
  return where === 'app' ? read(INTRO_SEASON_KEY) !== seasonByMonth() : read(INTRO_SEEN_KEY) !== '1'
}

// The head script's black page, when the intro turned out not to be due.
export function releaseIntroPending() {
  const root = document.documentElement
  if (root.dataset.intro === 'pending') delete root.dataset.intro
}

// `open`: the overlay shows. `playing`: the page is hidden and inert, and the scene follows the
// intro. `pageActive`: the page has the intro's transition, until it has risen into place.
// `shown`: how many lines have appeared. `revealed`: the black has lifted. `done`: the overlay
// fades out.
const [open, setOpen] = createSignal(false)
const [playing, setPlaying] = createSignal(false)
const [pageActive, setPageActive] = createSignal(false)
const [background, setBackground] = createSignal(false)
const [shown, setShown] = createSignal(0)
const [revealed, setRevealed] = createSignal(false)
const [done, setDone] = createSignal(false)
const [lines, setLines] = createSignal<string[]>([])
const [season, setSeason] = createSignal<Season>('winter')

export const intro = { open, playing, pageActive, shown, revealed, done, lines, season }

// The scene as the frames should show it: while the intro plays, always the weather, and the
// background only once it has faded in.
export function introScene<T extends Pick<SceneSettings, 'sceneBackground' | 'sceneWeather'>>(
  settings: T,
): T {
  return playing() ? { ...settings, sceneBackground: background(), sceneWeather: true } : settings
}

let timers: ReturnType<typeof setTimeout>[] = []
let returnFocus: HTMLElement | null = null
let skipButton: HTMLElement | undefined

export function setIntroSkipButton(el: HTMLElement) {
  skipButton = el
}

function at(ms: number, fn: () => void) {
  timers.push(setTimeout(fn, ms))
}

function clearTimers() {
  timers.forEach(clearTimeout)
  timers = []
}

function releaseTheme() {
  delete document.documentElement.dataset.intro
}

function revealPage() {
  setPlaying(false)
}

function end() {
  setOpen(false)
  setPageActive(false)
  markSeen()
}

function handFocus() {
  const active = document.activeElement
  if (active === document.body || (active && active.closest('.intro'))) {
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
    else if (active instanceof HTMLElement) active.blur()
  }
}

// Returns false when it can't play: with reduced motion. `focus` gets the focus back afterwards.
export function playIntro(options: { season: Season; signedIn: boolean; focus?: HTMLElement }) {
  const root = document.documentElement
  if (reducedMotion()) {
    releaseIntroPending()
    return false
  }
  clearTimers()
  returnFocus = options.focus ?? null
  setSeason(options.season)
  setLines(introLines(options.season, options.signedIn))

  // At the start the image, the page, and the theme switch at once, with transitions off:
  // fading them let the image show as the black lifted. Solid updates the DOM as the signals
  // change, so the styles are flushed before the transitions come back. Reading a scene layer's
  // style, not the body's, makes Firefox apply the cut when only descendants' styles changed.
  root.classList.add('intro-cut')
  root.dataset.intro = 'playing'
  setPageActive(true)
  setPlaying(true)
  setBackground(false)
  setOpen(true)
  setDone(false)
  setRevealed(false)
  setShown(0)
  for (const el of document.querySelectorAll('.scene-photo, .intro-page')) {
    void getComputedStyle(el).opacity
  }
  root.classList.remove('intro-cut')
  // On a page that has just hydrated, the overlay's portal mounts a moment later.
  skipButton?.focus()
  queueMicrotask(() => {
    if (skipButton?.isConnected && document.activeElement !== skipButton) skipButton.focus()
  })

  // The weather alone, the first line, a pause, the background fades in, a pause, then the
  // other lines, each after the one before has had time to be read. The last one gets a longer
  // beat before it and stays longest.
  at(300, () => setRevealed(true))
  for (const [i, ms] of [1900, 5400, 7700, 10200].entries()) at(ms, () => setShown(i + 1))
  at(3100, () => setBackground(true))
  at(13300, revealPage)
  at(13500, () => setDone(true))
  at(13850, () => {
    releaseTheme()
    handFocus()
  })
  at(14950, end)
  return true
}

export function skipIntro() {
  if (!playing()) return
  clearTimers()
  setRevealed(true)
  setDone(true)
  releaseTheme()
  revealPage()
  handFocus()
  at(1100, end)
  markSeen()
}

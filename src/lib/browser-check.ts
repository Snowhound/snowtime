// The check that tells a browser too old for the app (docs/architecture/platform.md, "Supported
// browsers"). It runs from <head>, before the app's scripts, which an old browser may not even
// parse, so it is ES5 on its own <script>, and a test parses it as ES5. It tests features,
// not versions: an older browser that has what the app uses sees no notice.
export const BROWSER_NOTICE_ID = 'browser-notice'
export const BROWSER_NOTICE_DISMISSED_KEY = 'snowtime.browserNoticeDismissed'

// What the app uses beyond Vite's build target (Chrome and Edge 111, Firefox 114, Safari
// 16.4): Tailwind 4's color-mix() and @property, :has() in the styles, and the ES2023 array
// methods tsconfig.json allows. A newer feature the app starts to need goes here.
export const browserCheckScript = `(function () {
  var ok = false
  try {
    ok =
      typeof Array.prototype.toSorted === 'function' &&
      typeof CSS.registerProperty === 'function' &&
      CSS.supports('selector(:has(a))') &&
      CSS.supports('color', 'color-mix(in oklab, red, blue)')
  } catch (e) {}
  if (ok) return
  try {
    if (sessionStorage.getItem(${JSON.stringify(BROWSER_NOTICE_DISMISSED_KEY)})) return
  } catch (e) {}
  document.addEventListener('DOMContentLoaded', function () {
    var notice = document.getElementById(${JSON.stringify(BROWSER_NOTICE_ID)})
    if (!notice) return
    notice.removeAttribute('hidden')
    notice.getElementsByTagName('button')[0].addEventListener('click', function () {
      notice.setAttribute('hidden', '')
      try {
        sessionStorage.setItem(${JSON.stringify(BROWSER_NOTICE_DISMISSED_KEY)}, '1')
      } catch (e) {}
    })
  })
})()`

import { defineConfig } from '@inlang/paraglide-js'

// Read by the Vite plugin and by `bun run i18n:compile`. The locale is in a cookie, not the
// URL: the app sets it from user_settings.locale once signed in, and signed-out pages fall
// back to the browser's language (docs/architecture.md, "Internationalization"). The cookie
// lasts 30 days, renewed on each page load (docs/architecture.md, "Cookies and consent").
export default defineConfig({
  outdir: './src/paraglide',
  strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
  cookieMaxAge: 30 * 24 * 60 * 60,
})

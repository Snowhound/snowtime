import { defineConfig } from '@inlang/paraglide-js'

// Read by the Vite plugin and by `bun run i18n:compile`. The locale is in a cookie, not the
// URL: the app sets it from user_settings.locale once signed in, and signed-out pages fall
// back to the browser's language (docs/architecture.md, "Internationalization").
export default defineConfig({
  outdir: './src/paraglide',
  strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
})

import { cleanup } from '@solidjs/testing-library'
import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

// Testing Library unmounts after each test by itself only when Vitest's globals are on.
afterEach(cleanup)

// jsdom has no layout, so it leaves scrollTo unimplemented; Kobalte's popovers call it.
window.scrollTo = () => {}

// Nor ResizeObserver; PageTitle places the tagline with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

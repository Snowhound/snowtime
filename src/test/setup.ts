import { cleanup } from '@solidjs/testing-library'
import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

// Testing Library unmounts after each test by itself only when Vitest's globals are on.
afterEach(cleanup)

// jsdom has no layout, so it leaves scrollTo unimplemented; Kobalte's popovers call it.
window.scrollTo = () => {}
// Nor scrollIntoView; the timer's rows call it when a save is confirmed.
Element.prototype.scrollIntoView = () => {}

// Nor ResizeObserver; PageTitle places the tagline with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Nor IntersectionObserver; the timer mounts later days' rows with it. This one never reports
// an intersection, so only the first screen's days mount unless a test presses Tab.
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver

// Nor matchMedia; the scene, the tagline, and the scenery settings ask about reduced motion.
window.matchMedia ??= (query) =>
  ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }) as unknown as MediaQueryList

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@solidjs/testing-library'
import { afterEach } from 'vitest'

// Testing Library unmounts after each test by itself only when Vitest's globals are on.
afterEach(cleanup)

import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { parse } from 'acorn'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BROWSER_NOTICE_DISMISSED_KEY, browserCheckScript } from '~/lib/browser-check'
import { BrowserNotice } from './browser-notice'

// A browser with what the app needs, or without :has().
function stubCss(hasSelector: boolean) {
  vi.stubGlobal('CSS', {
    registerProperty: () => {},
    supports: (...args: string[]) => hasSelector || !args[0].startsWith('selector('),
  })
}

// The check's listeners, removed after each test so one page load doesn't reach the next.
const listeners: EventListener[] = []

// Renders the page's notice and runs the <head> check as the browser would, with the
// document loaded after it.
function load() {
  render(() => <BrowserNotice />)
  const add = vi.spyOn(document, 'addEventListener')
  // oxlint-disable-next-line typescript/no-implied-eval -- runs the inline script as the page does.
  new Function(browserCheckScript)()
  listeners.push(...add.mock.calls.map((call) => call[1] as EventListener))
  add.mockRestore()
  document.dispatchEvent(new Event('DOMContentLoaded'))
  return document.getElementById('browser-notice')!
}

beforeEach(() => sessionStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  for (const listener of listeners.splice(0)) {
    document.removeEventListener('DOMContentLoaded', listener)
  }
})

test('the check is ES5, so an old browser parses it', () => {
  expect(() => parse(browserCheckScript, { ecmaVersion: 5 })).not.toThrow()
})

describe('BrowserNotice', () => {
  test('stays hidden in a browser with what the app needs', () => {
    stubCss(true)
    expect(load()).not.toBeVisible()
  })

  test('shows in a browser without a feature the app needs, until dismissed', async () => {
    stubCss(false)
    const notice = load()
    expect(notice).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('This browser is out of date.')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(notice).not.toBeVisible()
    expect(sessionStorage.getItem(BROWSER_NOTICE_DISMISSED_KEY)).toBe('1')
  })

  test('stays dismissed for the session', () => {
    stubCss(false)
    sessionStorage.setItem(BROWSER_NOTICE_DISMISSED_KEY, '1')
    expect(load()).not.toBeVisible()
  })

  test('shows when the browser has no CSS object at all', () => {
    vi.stubGlobal('CSS', undefined)
    expect(load()).toBeVisible()
  })
})

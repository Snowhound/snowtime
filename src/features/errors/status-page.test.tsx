import { render, screen } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'solid-js'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AppError } from '~/server/errors'
import { ErrorPage } from './error-page'
import { NotFoundPage } from './not-found-page'

const invalidate = vi.hoisted(() => vi.fn())
const frame = vi.hoisted(() => ({ inApp: false }))
vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: vi.fn() }))
// The pages render without a router; the frames stand in as marked wrappers, since the
// frame each page picks is what these tests check.
vi.mock('@tanstack/solid-router', () => ({
  Link: (props: { to: string; class?: string; children: JSX.Element }) => (
    <a href={props.to} class={props.class}>
      {props.children}
    </a>
  ),
  useRouter: () => ({ invalidate }),
}))
vi.mock('~/components/app-frame/app-frame', () => ({
  AppFrame: (props: { children: JSX.Element }) => (
    <div data-testid="app-frame">{props.children}</div>
  ),
  useInAppFrame: () => frame.inApp,
}))
vi.mock('~/components/auth-layout/auth-layout', () => ({
  AuthLayout: (props: { children: JSX.Element }) => (
    <div data-testid="auth-layout">{props.children}</div>
  ),
  AuthIcon: (props: { children: JSX.Element }) => props.children,
  AuthHeading: (props: { title: string; description?: string }) => (
    <>
      <h1>{props.title}</h1>
      <p>{props.description}</p>
    </>
  ),
}))

const member = { activeOrganizationId: 'org', user: { id: 'user' }, settings: null }
const withoutOrganization = { ...member, activeOrganizationId: null }

function renderPage(page: () => JSX.Element, session: object | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['session'], session)
  render(() => <QueryClientProvider client={queryClient}>{page()}</QueryClientProvider>)
}

function shownFrame() {
  if (screen.queryByTestId('app-frame')) return 'app frame'
  if (screen.queryByTestId('auth-layout')) return 'auth layout'
  return 'none'
}

function homeLink() {
  const link = screen.getAllByRole('link').at(-1)!
  return [link.textContent, link.getAttribute('href')]
}

beforeEach(() => {
  frame.inApp = false
})

describe('NotFoundPage', () => {
  test('signed out, sits in the auth layout and links to sign-in', () => {
    renderPage(() => <NotFoundPage />, null)
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(shownFrame()).toBe('auth layout')
    expect(homeLink()).toEqual(['Go to sign in', '/sign-in'])
  })

  test('for a member of an organization, sits in the app frame and links to the timer', () => {
    renderPage(() => <NotFoundPage />, member)
    expect(shownFrame()).toBe('app frame')
    expect(homeLink()).toEqual(['Go to the timer', '/timer'])
  })

  test('under the signed-in layout, adds no second app frame', () => {
    frame.inApp = true
    renderPage(() => <NotFoundPage />, member)
    expect(shownFrame()).toBe('none')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(homeLink()).toEqual(['Go to the timer', '/timer'])
  })

  test('signed in without an organization, sits in the auth layout and continues home', () => {
    renderPage(() => <NotFoundPage />, withoutOrganization)
    expect(shownFrame()).toBe('auth layout')
    expect(homeLink()).toEqual(['Continue', '/'])
  })
})

describe('ErrorPage', () => {
  beforeEach(() => invalidate.mockReset().mockResolvedValue(undefined))

  test("shows an AppError's translated message", () => {
    const error = new AppError('FORBIDDEN', 'team_report_forbidden')
    renderPage(() => <ErrorPage error={error} reset={() => {}} />, member)
    expect(screen.getByRole('heading', { name: "This page didn't load" })).toBeInTheDocument()
    expect(screen.getByText('You can report only on teams you lead.')).toBeInTheDocument()
    expect(shownFrame()).toBe('app frame')
  })

  test('shows a generic message for any other error, never its text', () => {
    const error = new Error('SQLITE_BUSY: database is locked')
    renderPage(() => <ErrorPage error={error} reset={() => {}} />, null)
    expect(screen.getByText('Something went wrong. Try again.')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('SQLITE_BUSY')
    expect(shownFrame()).toBe('auth layout')
    expect(homeLink()).toEqual(['Go to sign in', '/sign-in'])
  })

  test('shows the message the server rendered, when hydrating a loader error', () => {
    const error = Object.assign(new Error('You can report only on teams you lead.'), {
      name: 'ShownError',
    })
    renderPage(() => <ErrorPage error={error} reset={() => {}} />, member)
    expect(screen.getByText('You can report only on teams you lead.')).toBeInTheDocument()
  })

  test('tries again by loading the routes again, then rendering the page again', async () => {
    const reset = vi.fn()
    renderPage(() => <ErrorPage error={new Error('boom')} reset={reset} />, member)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(invalidate).toHaveBeenCalledOnce()
    expect(reset).toHaveBeenCalledOnce()
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0])
  })
})

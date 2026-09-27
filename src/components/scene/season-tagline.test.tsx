import { render, screen } from '@solidjs/testing-library'
import { afterEach, expect, test, vi } from 'vitest'
import { intro, playIntro, skipIntro } from '~/lib/scene/intro'
import { introLines } from '~/lib/scene/seasons'
import { SeasonTagline } from './season-tagline'

afterEach(() => {
  skipIntro()
  vi.useRealTimers()
})

test("shows the intro's set once the intro has played", () => {
  // Halloween in Tallinn, whose set the intro never shows.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-31T12:00:00Z'))
  render(() => <SeasonTagline season="autumn" timeZone="Europe/Tallinn" />)
  expect(screen.getByText('Something scary is lurking.')).toBeInTheDocument()

  playIntro({ season: 'autumn' })
  const [first, second] = introLines('autumn')
  expect(intro.lines()[0]).toBe(first)
  expect(screen.getByText(first)).toBeInTheDocument()
  expect(screen.getByText(second)).toBeInTheDocument()
  expect(screen.queryByText('Something scary is lurking.')).not.toBeInTheDocument()
})

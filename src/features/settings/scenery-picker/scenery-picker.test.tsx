import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SceneSettings } from '~/lib/scene/scene'
import { SceneryPicker } from './scenery-picker'

type Choice = Pick<SceneSettings, 'sceneCollection' | 'scenePin'>

// The calendar's month is September.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 15))
})
afterEach(() => vi.useRealTimers())

function renderPicker(initial: Choice) {
  const onChange = vi.fn()
  const [settings, setSettings] = createSignal(initial)
  render(() => (
    <SceneryPicker
      settings={settings()}
      onChange={(patch) => {
        onChange(patch)
        setSettings(patch)
      }}
    />
  ))
  return onChange
}

describe('SceneryPicker', () => {
  test('each collection says what shows; the chosen one is the tab stop', () => {
    renderPicker({ sceneCollection: 'coast', scenePin: 'coast-march' })
    const group = screen.getByRole('radiogroup', { name: 'Collection' })
    const coast = within(group).getByRole('radio', { name: 'Baltic coast' })
    expect(coast).toBeChecked()
    expect(coast).toHaveAttribute('tabindex', '0')
    expect(coast).toHaveAccessibleDescription('Changes every month. Pinned to March.')
    const mountains = within(group).getByRole('radio', { name: 'Mountain valley' })
    expect(mountains).toHaveAttribute('tabindex', '-1')
    expect(mountains).toHaveAccessibleDescription('Changes with the season. Now autumn.')
    expect(screen.getByText('Pinned to March. Unpin to follow the calendar.')).toBeInTheDocument()
  })

  test('arrow keys move through the collections and choose, clearing the pin', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onChange = renderPicker({ sceneCollection: 'mountains', scenePin: 'winter' })
    const group = screen.getByRole('radiogroup', { name: 'Collection' })
    await user.click(within(group).getByRole('radio', { name: 'Mountain valley' }))
    expect(onChange).not.toHaveBeenCalled()

    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith({ sceneCollection: 'countryside', scenePin: null })
    expect(within(group).getByRole('radio', { name: 'Baltic countryside' })).toHaveFocus()

    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith({ sceneCollection: 'coast', scenePin: null })
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith({ sceneCollection: 'mountains', scenePin: null })
  })

  test("the pin group lists the calendar and the collection's images", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onChange = renderPicker({ sceneCollection: 'countryside', scenePin: null })
    expect(screen.getByText('Follows the calendar: September now.')).toBeInTheDocument()
    await user.click(screen.getByText('Pin an image'))
    const pins = screen.getByRole('radiogroup', { name: 'Image in Baltic countryside' })
    const options = within(pins).getAllByRole('radio')
    expect(options).toHaveLength(13)
    expect(options[0]).toHaveAccessibleName('Follow the calendar (September now)')
    expect(options[0]).toBeChecked()

    await user.click(within(pins).getByRole('radio', { name: 'June' }))
    expect(onChange).toHaveBeenLastCalledWith({
      sceneCollection: 'countryside',
      scenePin: 'land-june',
    })
    expect(screen.getByText('Pinned to June. Unpin to follow the calendar.')).toBeInTheDocument()

    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith({ sceneCollection: 'countryside', scenePin: null })
  })
})

import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import userEvent from '@testing-library/user-event'
import { type JSX, createSignal } from 'solid-js'
import { describe, expect, test, vi } from 'vitest'
import { DatePicker } from './date-picker'
import { TimeInput } from './time-input'

// The session query's server function, which the settings are read through; the tests put the
// session in the cache instead.
vi.mock('~/server/auth/auth.functions', () => ({ getAppSession: vi.fn() }))

// A client whose session carries these settings, as the app's root loads it.
function withSettings(settings: object, children: () => JSX.Element) {
  const queryClient = new QueryClient()
  queryClient.setQueryData(['session'], { settings })
  return {
    queryClient,
    ui: () => <QueryClientProvider client={queryClient}>{children()}</QueryClientProvider>,
  }
}

function renderPicker(initial: string, options: { live?: boolean; max?: string } = {}) {
  const onChange = vi.fn()
  const [value, setValue] = createSignal(initial)
  // Month first, so the short forms below read as in the US.
  const { ui } = withSettings({ dateFormat: 'mdy' }, () => (
    <>
      <label for="d">Date</label>
      <DatePicker
        id="d"
        value={value()}
        onChange={(next, how) => {
          setValue(next)
          onChange(next, how)
        }}
        weekStart="mon"
        today="2026-09-25"
        max={options.max}
        live={options.live}
      />
    </>
  ))
  render(ui)
  return { input: screen.getByLabelText('Date') as HTMLInputElement, onChange }
}

describe('DatePicker', () => {
  test('shows the date in the locale format and reads typed short forms on blur', () => {
    const { input, onChange } = renderPicker('2026-09-05')
    expect(input).toHaveValue('09/05/2026')
    fireEvent.input(input, { target: { value: '9/7' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith('2026-09-07', 'blur')
    expect(input).toHaveValue('09/07/2026')
  })

  test('puts back the value when the text is not a date', () => {
    const { input, onChange } = renderPicker('2026-09-05')
    fireEvent.input(input, { target: { value: '13/45' } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('09/05/2026')
  })

  test('live, reports every keystroke and none while the text is not a date', () => {
    const { input, onChange } = renderPicker('2026-09-05', { live: true })
    fireEvent.input(input, { target: { value: '9/' } })
    expect(onChange).toHaveBeenLastCalledWith('', 'type')
    fireEvent.input(input, { target: { value: '9/6' } })
    expect(onChange).toHaveBeenLastCalledWith('2026-09-06', 'type')
    expect(input).toHaveValue('9/6')
  })

  test('arrow keys move a day', () => {
    const { input, onChange } = renderPicker('2026-09-30')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('2026-10-01', 'type')
    expect(input).toHaveValue('10/01/2026')
  })

  test('the calendar opens on the value, moves with the keys, and picks', async () => {
    const user = userEvent.setup()
    const { input, onChange } = renderPicker('2026-09-05', { max: '2026-09-25' })
    await user.click(screen.getByRole('button', { name: 'Choose date' }))
    const day = await screen.findByRole('button', { name: 'Saturday, September 5, 2026' })
    expect(day).toHaveFocus()
    expect(screen.getByRole('grid', { name: 'September 2026' })).toBeInTheDocument()
    // Weeks start on Monday.
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('abbr', 'Monday')

    await user.keyboard('{ArrowDown}{ArrowRight}')
    expect(screen.getByRole('button', { name: 'Sunday, September 13, 2026' })).toHaveFocus()
    await user.keyboard('{PageUp}')
    expect(screen.getByRole('button', { name: 'Thursday, August 13, 2026' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('2026-08-13', 'pick')
    expect(input).toHaveValue('08/13/2026')
  })

  test('one click picks a day, in this month or the next', async () => {
    const user = userEvent.setup()
    const { input, onChange } = renderPicker('2026-09-05')
    await user.click(screen.getByRole('button', { name: 'Choose date' }))
    await user.click(await screen.findByRole('button', { name: 'Tuesday, September 15, 2026' }))
    expect(onChange).toHaveBeenLastCalledWith('2026-09-15', 'pick')
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Choose date' }))
    await user.click(await screen.findByRole('button', { name: 'Sunday, October 4, 2026' }))
    expect(onChange).toHaveBeenLastCalledWith('2026-10-04', 'pick')
    expect(input).toHaveValue('10/04/2026')
  })

  test('days after max cannot be picked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker('2026-09-24', { max: '2026-09-25' })
    await user.click(screen.getByRole('button', { name: 'Choose date' }))
    const late = await screen.findByRole('button', { name: 'Saturday, September 26, 2026' })
    expect(late).toHaveAttribute('aria-disabled', 'true')
    await user.click(late)
    expect(onChange).not.toHaveBeenCalled()
  })

  test('shows day first by default, and follows the date format setting as it changes', async () => {
    const onChange = vi.fn()
    const { queryClient, ui } = withSettings({}, () => (
      <>
        <label for="d">Date</label>
        <DatePicker
          id="d"
          value="2026-09-05"
          onChange={onChange}
          weekStart="mon"
          today="2026-09-25"
        />
      </>
    ))
    render(ui)
    const input = screen.getByLabelText('Date') as HTMLInputElement
    expect(input).toHaveValue('05.09.2026')
    expect(input).toHaveAttribute('placeholder', 'dd.mm.yyyy')
    fireEvent.input(input, { target: { value: '7.9' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith('2026-09-07', 'blur')

    queryClient.setQueryData(['session'], { settings: { dateFormat: 'mdy' } })
    await waitFor(() => expect(input).toHaveValue('09/05/2026'))
  })
})

describe('TimeInput', () => {
  function renderTime(initial: string, timeFormat: '24h' | '12h' = '24h') {
    const onChange = vi.fn()
    const onCommit = vi.fn()
    const [value, setValue] = createSignal(initial)
    const { ui } = withSettings({ timeFormat }, () => (
      <TimeInput
        aria-label="Start"
        value={value()}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
        onCommit={onCommit}
      />
    ))
    render(ui)
    return { input: screen.getByLabelText('Start') as HTMLInputElement, onChange, onCommit }
  }

  function text(input: HTMLInputElement) {
    return input.value.replace(/\s/g, ' ')
  }

  test('reads short forms as they are typed and tidies them on blur', () => {
    const { input, onChange } = renderTime('')
    fireEvent.input(input, { target: { value: '930p' } })
    expect(onChange).toHaveBeenLastCalledWith('21:30')
    fireEvent.input(input, { target: { value: '93' } })
    expect(onChange).toHaveBeenLastCalledWith('')
    fireEvent.input(input, { target: { value: '9.30' } })
    fireEvent.blur(input)
    expect(text(input)).toBe('09:30')
  })

  test('arrow keys move the hour or the minute, by the caret', () => {
    const { input, onChange } = renderTime('09:30')
    input.setSelectionRange(1, 1)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('10:30')
    input.setSelectionRange(4, 4)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith('10:29')
    expect(text(input)).toBe('10:29')
  })

  test('the clock opens hours and 5-minute steps, and a minute finishes the pick', async () => {
    const user = userEvent.setup()
    const { input, onChange, onCommit } = renderTime('09:30')
    await user.click(screen.getByRole('button', { name: 'Choose time' }))
    const hours = await screen.findByRole('listbox', { name: 'Hours' })
    const minutes = screen.getByRole('listbox', { name: 'Minutes' })
    expect(within(hours).getAllByRole('option')).toHaveLength(24)
    expect(
      within(minutes)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'])
    expect(within(hours).getByRole('option', { name: '09' })).toHaveFocus()

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('11:30')
    expect(screen.getByRole('listbox', { name: 'Hours' })).toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()

    await user.click(within(minutes).getByRole('option', { name: '45' }))
    expect(onChange).toHaveBeenLastCalledWith('11:45')
    expect(text(input)).toBe('11:45')
    expect(screen.queryByRole('listbox', { name: 'Hours' })).not.toBeInTheDocument()
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  test('a typed minute off the steps shows as picked', async () => {
    const user = userEvent.setup()
    renderTime('09:33')
    await user.click(screen.getByRole('button', { name: 'Choose time' }))
    const minutes = await screen.findByRole('listbox', { name: 'Minutes' })
    expect(within(minutes).getByRole('option', { name: '33' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('Escape in the columns puts back the time they opened on', async () => {
    const user = userEvent.setup()
    const { input, onChange, onCommit } = renderTime('09:30')
    await user.click(screen.getByRole('button', { name: 'Choose time' }))
    await screen.findByRole('listbox', { name: 'Hours' })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('10:30')
    await user.keyboard('{Escape}')
    expect(onChange).toHaveBeenLastCalledWith('09:30')
    expect(text(input)).toBe('09:30')
    expect(onCommit).not.toHaveBeenCalled()
  })

  test('in the 12-hour format, shows AM and PM and picks them in a third column', async () => {
    const user = userEvent.setup()
    const { input, onChange } = renderTime('09:30', '12h')
    expect(text(input)).toBe('09:30 AM')
    await user.click(screen.getByRole('button', { name: 'Choose time' }))
    const hours = await screen.findByRole('listbox', { name: 'Hours' })
    expect(
      within(hours)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['12', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'])
    const period = screen.getByRole('listbox', { name: 'AM or PM' })
    expect(within(period).getByRole('option', { name: 'AM' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await user.click(within(period).getByRole('option', { name: 'PM' }))
    expect(onChange).toHaveBeenLastCalledWith('21:30')
    await user.click(within(hours).getByRole('option', { name: '12' }))
    expect(onChange).toHaveBeenLastCalledWith('12:30')
    await user.click(screen.getByRole('option', { name: '45' }))
    expect(onChange).toHaveBeenLastCalledWith('12:45')
    expect(text(input)).toBe('12:45 PM')
  })
})

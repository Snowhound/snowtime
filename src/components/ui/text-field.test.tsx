import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { createSignal } from 'solid-js'
import { describe, expect, test } from 'vitest'
import { Button } from './button'
import { TextField, TextFieldErrorMessage, TextFieldInput, TextFieldLabel } from './text-field'

// Checks the component test setup: Kobalte renders in the DOM, labels connect to inputs,
// and events reach Solid handlers.
describe('Solid-UI in the test DOM', () => {
  test('a text field shows its error when invalid', async () => {
    const [value, setValue] = createSignal('')
    render(() => (
      <TextField
        value={value()}
        onChange={setValue}
        validationState={value() ? 'valid' : 'invalid'}
      >
        <TextFieldLabel>Name</TextFieldLabel>
        <TextFieldInput />
        <TextFieldErrorMessage>Enter a name.</TextFieldErrorMessage>
      </TextField>
    ))
    expect(screen.getByText('Enter a name.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Name'), 'Snowtime')
    expect(value()).toBe('Snowtime')
    expect(screen.queryByText('Enter a name.')).not.toBeInTheDocument()
  })

  test('a button runs its click handler', async () => {
    let clicks = 0
    render(() => <Button onClick={() => clicks++}>Start</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(clicks).toBe(1)
  })
})

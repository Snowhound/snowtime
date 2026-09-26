import { render, screen, waitFor } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { ProjectSelect } from './project-select'

const projects = [{ id: 'p1', name: 'Snowtime', archivedAt: null, color: '#3b82b8' }]

describe('ProjectSelect', () => {
  test('Tab in the open list closes it and keeps focus on the picker', async () => {
    render(() => (
      <ProjectSelect
        id="project"
        label="Project"
        projects={projects}
        value=""
        onChange={() => {}}
      />
    ))
    const trigger = screen.getByLabelText('Project')
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    await screen.findByRole('listbox')

    await userEvent.keyboard('{Tab}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
})

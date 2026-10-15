import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { it, expect, vi } from 'vitest'
import { App } from './app'

vi.mock('@/shared/model/config', () => ({ CONFIG: { IS_DEV: true } }))

it('shows a visible dev environment label on application pages', () => {
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>
  )
  expect(screen.getByRole('status')).toHaveTextContent(/^DEV$/)
})

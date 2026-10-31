import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { it, expect, vi, onTestFinished } from 'vitest'
import { createApplicationRoute } from './application-route'

vi.mock('@/shared/model/config', () => ({ CONFIG: { IS_DEV: true } }))

it('shows a visible dev environment label on application pages', () => {
  const router = createMemoryRouter([
    createApplicationRoute([{ path: '*', element: <main /> }]),
  ])
  onTestFinished(() => router.dispose())
  render(<RouterProvider router={router} />)
  expect(screen.getByRole('status')).toHaveTextContent(/^DEV$/)
})

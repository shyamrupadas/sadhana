import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { transferableAbortController } from 'node:util'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest'

import { Component as LoginPage } from '@/features/auth/login.page'
import { Component as RegisterPage } from '@/features/auth/register.page'
import { Component as SettingsPage } from '@/features/settings/settings.page'
import { useSession } from '@/shared/model/session'
import { mockApi, renderWithTestProviders } from '@/shared/test/harness'
import { protectedLoader } from './protected-loader'
import { ProtectedRoute } from './protected-route'

afterEach(() => useSession.getState().logout())

beforeEach(() => {
  // Match Node's Request implementation; jsdom's AbortSignal is a different class.
  vi.stubGlobal(
    'AbortController',
    vi.fn(() => transferableAbortController())
  )
  vi.stubGlobal(
    'ResizeObserver',
    vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }))
  )
})

function openPage(path: string) {
  const fetchMock = mockApi(({ method, path }) => {
    throw new Error(`Неожиданный API-запрос: ${method} ${path}`)
  })
  const router = createMemoryRouter(
    [
      { path: '/login', Component: LoginPage },
      { path: '/register', Component: RegisterPage },
      {
        loader: protectedLoader,
        Component: ProtectedRoute,
        HydrateFallback: () => null,
        children: [{ path: '/settings', Component: SettingsPage }],
      },
    ],
    { initialEntries: [path] }
  )
  renderWithTestProviders(<RouterProvider router={router} />)
  onTestFinished(() => router.dispose())
  return { router, fetchMock }
}

test('перенаправляет гостя с защищённой страницы на вход без запроса к API', async () => {
  const { router, fetchMock } = openPage('/settings')

  await screen.findByRole('button', { name: 'Войти' })
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  expect(screen.queryByRole('heading', { name: 'Настройки' })).not.toBeInTheDocument()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('показывает ошибки email и короткого пароля до отправки формы входа', async () => {
  const { fetchMock } = openPage('/login')
  const user = userEvent.setup()

  await user.type(screen.getByLabelText('Email', { exact: true }), 'incorrect')
  await user.type(screen.getByLabelText('Пароль', { exact: true }), '123')
  await user.click(screen.getByRole('button', { name: 'Войти' }))

  expect(await screen.findByText('Некорректный email')).toBeVisible()
  expect(screen.getByText('Пароль должен быть не менее 6 символов')).toBeVisible()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('не отправляет регистрацию при несовпадающих паролях', async () => {
  const { fetchMock } = openPage('/register')
  const user = userEvent.setup()

  await user.type(screen.getByLabelText('Email', { exact: true }), 'user@example.test')
  await user.type(screen.getByLabelText('Пароль', { exact: true }), 'valid-password')
  await user.type(screen.getByLabelText('Подтвердите пароль'), 'other-password')
  await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))

  expect(await screen.findByText('Пароли не совпадают')).toBeVisible()
  expect(fetchMock).not.toHaveBeenCalled()
})

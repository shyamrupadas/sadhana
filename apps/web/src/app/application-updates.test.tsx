import { act, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest'

import { mockApi } from '@/shared/test/harness'
import { App } from './app'
import { queryClient } from '@/shared/api/query-client'
import { Component as MainPage } from '@/features/main/main.page'
import { useSession } from '@/shared/model/session'
import userEvent from '@testing-library/user-event'
import { within } from '@testing-library/react'
import type { ApiSchemas } from '@sadhana/api-contract'

const interval = 10 * 60 * 1000
const unexpectedRequests: string[] = []

function unexpectedRequest(request: string): never {
  unexpectedRequests.push(request)
  throw new Error(`Неожиданный запрос: ${request}`)
}

class Worker extends EventTarget {
  state: ServiceWorkerState = 'activated'
  scriptURL = `${window.location.origin}/sw.js`
  postMessage = vi.fn()
}

function browserWorker() {
  const active = new Worker()
  const registration = Object.assign(new EventTarget(), {
    active: active as Worker | null,
    installing: null as Worker | null,
    waiting: null as Worker | null,
    update: vi.fn(async () => {}),
  })
  const serviceWorker = Object.assign(new EventTarget(), {
    controller: active as Worker | null,
    register: vi.fn(async () => registration),
  })
  vi.stubGlobal('navigator', { serviceWorker })
  return { registration, serviceWorker }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('VITE_BUILD_ID', 'build-a')
  sessionStorage.clear()
  queryClient.clear()
  useSession.getState().logout()
  unexpectedRequests.length = 0
})

afterEach(() => {
  expect(unexpectedRequests).toEqual([])
  vi.useRealTimers()
  vi.unstubAllEnvs()
  sessionStorage.clear()
  queryClient.clear()
})

async function openApp(page = <h1>Рабочая страница</h1>) {
  const router = createMemoryRouter(
    [{ Component: App, children: [{ path: '*', element: page }] }],
    { initialEntries: ['/statistics?period=month#habits'] }
  )
  const view = render(<RouterProvider router={router} />)
  onTestFinished(() => router.dispose())
  await act(async () => {})
  return { ...view, router }
}

test('проверяет версию при запуске и раз в десять минут, сохраняя интерфейс при ошибке', async () => {
  const fetchMock = mockApi(({ method, path }) => {
    if (method === 'GET' && path === '/release.json') {
      return { status: 200, body: { version: 'build-a' } }
    }
    return unexpectedRequest(`${method} ${path}`)
  })
  const reload = vi.fn()
  vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
  const { router } = await openApp()

  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('heading', { name: 'Рабочая страница' })).toBeVisible()
  expect(screen.queryByText('Проверяем обновление…')).not.toBeInTheDocument()
  await act(() => vi.advanceTimersByTimeAsync(interval - 1))
  expect(fetchMock).toHaveBeenCalledTimes(1)
  fetchMock.mockRejectedValueOnce(new TypeError('Нет сети'))
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('heading')).toBeVisible()
  await act(() => vi.advanceTimersByTimeAsync(interval))
  expect(fetchMock).toHaveBeenCalledTimes(3)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(fetchMock).toHaveBeenCalledTimes(3)
  // A suspended browser can miss timer callbacks entirely.
  vi.setSystemTime(Date.now() + interval)
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(fetchMock).toHaveBeenCalledTimes(4)
  expect(reload).not.toHaveBeenCalled()
  router.dispose()
})

test.each([
  { status: 200, body: '{broken' },
  { status: 200, body: JSON.stringify({ version: 2 }) },
  { status: 503, body: JSON.stringify({ version: 'build-b' }) },
])(
  'не принимает ошибочный release.json за обновление: $status $body',
  async ({ status, body }) => {
    browserWorker()
    const reload = vi.fn()
    vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        if (input === '/release.json') return new Response(body, { status })
        return unexpectedRequest(String(input))
      })
    )
    await openApp()
    expect(screen.getByRole('heading')).toBeVisible()
    expect(reload).not.toHaveBeenCalled()
    expect(screen.queryByText('Приложение обновлено')).not.toBeInTheDocument()
  }
)

test('после неудачной установки повторяет подготовку позже, без перезапуска старого worker', async () => {
  const { registration } = browserWorker()
  const worker = new Worker()
  worker.state = 'installing'
  registration.installing = worker
  registration.update.mockRejectedValueOnce(new Error('Статика ещё передаётся'))
  let preparedVersion = 'build-a'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      if (input === '/release.json')
        return new Response(JSON.stringify({ version: 'build-b' }))
      if (input === '/index.html')
        return new Response(`<meta name="app-version" content="${preparedVersion}">`)
      return unexpectedRequest(String(input))
    })
  )
  const reload = vi.fn()
  vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
  await openApp()
  expect(screen.getByRole('heading')).toBeVisible()
  expect(reload).not.toHaveBeenCalled()
  registration.installing = null
  await act(() => vi.advanceTimersByTimeAsync(interval))
  expect(reload).not.toHaveBeenCalled()
  preparedVersion = 'build-b'
  await act(() => vi.advanceTimersByTimeAsync(interval))
  expect(reload).toHaveBeenCalledTimes(1)
})

test('ожидает подготовленный HTML нового worker и перезапускается один раз с сохранением адреса', async () => {
  const { registration, serviceWorker } = browserWorker()
  const worker = new Worker()
  worker.state = 'installing'
  registration.installing = worker
  let ready = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      if (input === '/release.json')
        return new Response(JSON.stringify({ version: 'build-b' }))
      if (input === '/index.html') {
        return new Response(
          `<meta name="app-version" content="${ready ? 'build-b' : 'build-a'}">`
        )
      }
      return unexpectedRequest(String(input))
    })
  )
  const reload = vi.fn()
  vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
  const { router } = await openApp()
  expect(reload).not.toHaveBeenCalled()
  expect(screen.getByRole('heading')).toBeVisible()

  await act(async () => {
    ready = true
    registration.installing = null
    registration.active = worker
    serviceWorker.controller = worker
    worker.state = 'activated'
    worker.dispatchEvent(new Event('statechange'))
    serviceWorker.dispatchEvent(new Event('controllerchange'))
  })
  expect(reload).toHaveBeenCalledTimes(1)
  expect(router.state.location).toMatchObject({
    pathname: '/statistics',
    search: '?period=month',
    hash: '#habits',
  })
  await act(() => vi.advanceTimersByTimeAsync(interval))
  expect(reload).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Приложение обновлено')).not.toBeInTheDocument()
})

test('подтверждает смену выполняемой сборки только после загрузки данных страницы', async () => {
  browserWorker()
  const reload = vi.fn()
  vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      if (input === '/release.json')
        return new Response(JSON.stringify({ version: 'build-b' }))
      if (input === '/index.html')
        return new Response('<meta name="app-version" content="build-b">')
      return unexpectedRequest(String(input))
    })
  )
  const oldPage = await openApp()
  expect(reload).toHaveBeenCalledTimes(1)
  oldPage.unmount()

  // Reloading the same JavaScript never confirms an update or permits another reload.
  const sameBuild = await openApp()
  expect(screen.queryByText('Приложение обновлено')).not.toBeInTheDocument()
  expect(reload).toHaveBeenCalledTimes(1)
  sameBuild.unmount()

  let resolveData!: (value: string) => void
  const data = new Promise<string>((resolve) => {
    resolveData = resolve
  })
  function Page() {
    const query = useQuery({ queryKey: ['restored-page'], queryFn: () => data })
    return <h1>{query.data ?? 'Загружаем данные'}</h1>
  }
  vi.stubEnv('VITE_BUILD_ID', 'build-b')
  await openApp(<Page />)
  expect(screen.getByRole('heading')).toHaveTextContent('Загружаем данные')
  expect(screen.queryByText('Приложение обновлено')).not.toBeInTheDocument()
  await act(async () => {
    resolveData('Данные восстановлены')
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(screen.getByRole('heading')).toHaveTextContent('Данные восстановлены')
  expect(screen.getByText('Приложение обновлено')).toBeVisible()
})

test('ожидающий worker и событие другой вкладки используют одну подготовку', async () => {
  const { registration, serviceWorker } = browserWorker()
  const worker = new Worker()
  worker.state = 'installed'
  registration.waiting = worker
  let htmlVersion = 'build-a'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      if (input === '/release.json')
        return new Response(JSON.stringify({ version: 'build-b' }))
      if (input === '/index.html')
        return new Response(`<meta name="app-version" content="${htmlVersion}">`)
      return unexpectedRequest(String(input))
    })
  )
  const reload = vi.fn()
  vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
  await openApp()
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  expect(reload).not.toHaveBeenCalled()
  await act(async () => {
    registration.waiting = null
    registration.active = worker
    serviceWorker.controller = worker
    worker.state = 'activated'
    htmlVersion = 'build-b'
    serviceWorker.dispatchEvent(new Event('controllerchange'))
    serviceWorker.dispatchEvent(new Event('controllerchange'))
  })
  expect(reload).toHaveBeenCalledTimes(1)
})

test('не перезапускается без возможности сохранить защиту от цикла', async () => {
  browserWorker()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      if (input === '/release.json')
        return new Response(JSON.stringify({ version: 'build-b' }))
      if (input === '/index.html')
        return new Response('<meta name="app-version" content="build-b">')
      return unexpectedRequest(String(input))
    })
  )
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked')
  })
  const reload = vi.fn()
  vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
  await openApp()
  await act(() => vi.advanceTimersByTimeAsync(interval))
  expect(reload).not.toHaveBeenCalled()
  expect(screen.getByRole('heading')).toBeVisible()
})

test('зависшая регистрация worker не останавливает следующие фоновые проверки', async () => {
  const { serviceWorker } = browserWorker()
  serviceWorker.register.mockReturnValueOnce(new Promise(() => {}))
  const fetchMock = mockApi(({ method, path }) => {
    if (method === 'GET' && path === '/release.json')
      return { status: 200, body: { version: 'build-b' } }
    return unexpectedRequest(`${method} ${path}`)
  })
  const reload = vi.fn()
  vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
  await openApp()
  await act(() => vi.advanceTimersByTimeAsync(interval))
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(reload).not.toHaveBeenCalled()
  expect(screen.getByRole('heading')).toBeVisible()
})

test('после обновления заново читает данные дня и не повторяет уже отправленную отметку', async () => {
  vi.useRealTimers()
  const { serviceWorker } = browserWorker()
  await act(async () => {
    useSession
      .getState()
      .login(
        `header.${btoa(JSON.stringify({ exp: 4102444800, userId: 'update-user' }))}.signature`
      )
  })
  let published = 'build-a'
  let commands = 0
  let reads = 0
  const fetchMock = mockApi(({ method, path }) => {
    if (method === 'GET' && path === '/release.json')
      return { status: 200, body: { version: published } }
    if (method === 'GET' && path === '/test-api/habits')
      return {
        status: 200,
        body: [
          {
            key: 'reading',
            label: 'Чтение',
            createdAt: '2026-10-01T00:00:00.000Z',
            startDate: '2026-10-01',
            archived: false,
          } satisfies ApiSchemas['HabitDefinition'],
        ],
      }
    if (method === 'GET' && path === '/test-api/sleep-records') {
      reads++
      return { status: 200, body: [] }
    }
    if (
      method === 'PATCH' &&
      /^\/test-api\/sleep-records\/\d{4}-\d{2}-\d{2}\/habits\/reading$/.test(path)
    ) {
      commands++
      // The server may have accepted this command, despite the interrupted response.
      return new Promise(() => {})
    }
    return unexpectedRequest(`${method} ${path}`)
  })
  const http = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((input, init) =>
    input === '/index.html'
      ? Promise.resolve(new Response('<meta name="app-version" content="build-b">'))
      : http(input, init)
  )
  const reload = vi.fn()
  vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
  const oldPage = await openApp(<MainPage />)
  const row = await screen.findByRole('row', { name: /Чтение/ })
  expect(reads).toBe(1)
  const user = userEvent.setup()
  await user.click(within(row).getAllByRole('button', { name: 'Не отмечено' }).at(-1)!)
  expect(commands).toBe(1)
  published = 'build-b'
  await act(async () => {
    serviceWorker.dispatchEvent(new Event('controllerchange'))
  })
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  oldPage.unmount()
  // A real reload creates a fresh, non-persisted QueryClient and mutation cache.
  queryClient.clear()
  vi.stubEnv('VITE_BUILD_ID', 'build-b')
  await openApp(<MainPage />)
  await screen.findByRole('row', { name: /Чтение/ })
  expect(reads).toBe(2)
  expect(commands).toBe(1)
  expect(screen.getByRole('row', { name: /Чтение/ })).toBeVisible()
  expect(await screen.findByText('Приложение обновлено')).toBeVisible()
})

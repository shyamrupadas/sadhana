import { act, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest'

import { mockApi } from '@/shared/test/harness'
import { queryClient } from '@/shared/api/query-client'
import { Component as MainPage } from '@/features/main/main.page'
import { useSession } from '@/shared/model/session'
import userEvent from '@testing-library/user-event'
import { within } from '@testing-library/react'
import type { ApiSchemas } from '@sadhana/api-contract'
import { StrictMode, useState } from 'react'
import { createApplicationRoute } from './application-route'
import { transferableAbortController } from 'node:util'
import { Component as LoginPage } from '@/features/auth/login.page'
import { protectedLoader } from './protected-loader'

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
  vi.stubGlobal(
    'ResizeObserver',
    vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }))
  )
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
    [createApplicationRoute([{ path: '*', element: page }])],
    { initialEntries: ['/statistics?period=month#habits'] }
  )
  const view = render(<RouterProvider router={router} />)
  onTestFinished(() => router.dispose())
  await act(async () => {})
  return { ...view, router }
}

const errorMessage = 'Что-то идёт не так, обновите страницу или попробуйте позже'

function BrokenPage() {
  const [broken, setBroken] = useState(false)
  if (broken) throw new Error('Ошибка отображения')
  return <button onClick={() => setBroken(true)}>Сломать страницу</button>
}

test('после ошибки интерфейса проверяет обновление и даёт ручной повтор без новой сборки', async () => {
  vi.useRealTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let resolveRelease!: (value: Response) => void
  const fetchMock = vi.fn(async (input) => {
    if (input !== '/release.json') return unexpectedRequest(String(input))
    return new Promise<Response>((resolve) => {
      resolveRelease = resolve
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  const reload = vi.fn()
  vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
  await openApp(<BrokenPage />)
  await userEvent.click(screen.getByRole('button', { name: 'Сломать страницу' }))
  expect(screen.getByText('Проверяем обновление…')).toBeVisible()
  await act(async () => {
    resolveRelease(new Response(JSON.stringify({ version: 'build-a' })))
  })
  expect(
    screen.getByText('Что-то идёт не так, обновите страницу или попробуйте позже')
  ).toBeVisible()
  expect(reload).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Обновить страницу' }))
  await act(async () => {
    resolveRelease(new Response(JSON.stringify({ version: 'build-a' })))
  })
  expect(reload).toHaveBeenCalledTimes(1)
})

test('ошибка удалённого чанка при первом открытии восстанавливается и в StrictMode', async () => {
  vi.stubGlobal(
    'AbortController',
    vi.fn(() => transferableAbortController())
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
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
  const router = createMemoryRouter([
    createApplicationRoute([
      {
        path: '*',
        lazy: async () => {
          throw new TypeError(
            'Failed to fetch dynamically imported module: /assets/old.js'
          )
        },
      },
    ]),
  ])
  onTestFinished(() => router.dispose())
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  )
  await act(async () => {})
  expect(reload).toHaveBeenCalledTimes(1)
})

test.each([10_000, 16_000])(
  'ошибка маршрута через %s мс не заменяет общую попытку восстановления',
  async (delay) => {
    vi.stubGlobal(
      'AbortController',
      vi.fn(() => transferableAbortController())
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        if (input === '/release.json') return new Promise<Response>(() => {})
        return unexpectedRequest(String(input))
      })
    )
    let rejectRoute!: (error: Error) => void
    const lazyRoute = new Promise<never>((_resolve, reject) => {
      rejectRoute = reject
    })
    const router = createMemoryRouter([
      createApplicationRoute([
        { path: '/', element: <h1>Рабочая страница</h1> },
        { path: '/broken', lazy: () => lazyRoute },
      ]),
    ])
    onTestFinished(() => router.dispose())
    render(<RouterProvider router={router} />)
    await act(async () => {
      void router.navigate('/broken')
      window.dispatchEvent(
        new ErrorEvent('error', { error: new Error('Сбой API во время навигации') })
      )
    })
    expect(screen.getByText('Проверяем обновление…')).toBeVisible()
    await act(() => vi.advanceTimersByTimeAsync(delay))
    await act(async () => {
      rejectRoute(new Error('Loading chunk failed'))
    })
    if (delay < 15_000) await act(() => vi.advanceTimersByTimeAsync(15_000 - delay))
    expect(screen.getByText(errorMessage)).toBeVisible()
  }
)

test('общий бюджет 15 секунд не продлевается параллельным сбоем, поздний worker ждёт ручного повтора', async () => {
  const { registration, serviceWorker } = browserWorker()
  const worker = new Worker()
  worker.state = 'installing'
  registration.installing = worker
  let resolveRelease!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      if (input === '/release.json')
        return new Promise<Response>((resolve) => {
          resolveRelease = resolve
        })
      if (input === '/index.html')
        return new Response('<meta name="app-version" content="build-b">')
      return unexpectedRequest(String(input))
    })
  )
  const reload = vi.fn()
  vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
  await openApp()
  const fail = () =>
    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('Сбой обработчика') })
    )
  await act(async () => {
    fail()
  })
  expect(screen.getByText('Проверяем обновление…')).toBeVisible()
  await act(() => vi.advanceTimersByTimeAsync(10_000))
  await act(async () => {
    resolveRelease(new Response(JSON.stringify({ version: 'build-b' })))
  })
  await act(() => vi.advanceTimersByTimeAsync(4_999))
  await act(async () => {
    fail()
  })
  expect(screen.getByText('Проверяем обновление…')).toBeVisible()
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(screen.getByText(errorMessage)).toBeVisible()
  await act(async () => {
    registration.installing = null
    registration.active = worker
    serviceWorker.controller = worker
    worker.state = 'activated'
    worker.dispatchEvent(new Event('statechange'))
    serviceWorker.dispatchEvent(new Event('controllerchange'))
  })
  await act(() => vi.advanceTimersByTimeAsync(interval))
  expect(reload).not.toHaveBeenCalled()
  vi.useRealTimers()
  await userEvent.click(screen.getByRole('button', { name: 'Обновить страницу' }))
  await act(async () => {
    resolveRelease(new Response(JSON.stringify({ version: 'build-b' })))
  })
  expect(reload).toHaveBeenCalledTimes(1)
})

test.each(['build-a', 'build-b'])(
  'сбой после reload сборки %s до загрузки данных сразу даёт ошибку без второй попытки',
  async (version) => {
    browserWorker()
    let published = 'build-a'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        if (input === '/release.json')
          return new Response(JSON.stringify({ version: published }))
        if (input === '/index.html')
          return new Response('<meta name="app-version" content="build-b">')
        return unexpectedRequest(String(input))
      })
    )
    const reload = vi.fn()
    vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
    const oldPage = await openApp()
    published = 'build-b'
    await act(async () => {
      window.dispatchEvent(new ErrorEvent('error', { error: new Error('Первый сбой') }))
    })
    expect(reload).toHaveBeenCalledTimes(1)
    oldPage.unmount()
    queryClient.clear()
    vi.stubEnv('VITE_BUILD_ID', version)
    let rejectData!: (error: Error) => void
    const data = new Promise<string>((_resolve, reject) => {
      rejectData = reject
    })
    function Page() {
      const query = useQuery({ queryKey: ['necessary-data'], queryFn: () => data })
      return <h1>{query.data ?? 'Загрузка данных'}</h1>
    }
    await openApp(<Page />)
    await act(async () => {
      rejectData(new Error('Данные не восстановлены'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText(errorMessage)).toBeVisible()
    await act(() => vi.advanceTimersByTimeAsync(interval))
    expect(reload).toHaveBeenCalledTimes(1)
  }
)

test('неожиданная ошибка API чтения проходит через общий экран восстановления', async () => {
  vi.useRealTimers()
  await act(async () => {
    useSession
      .getState()
      .login(
        `header.${btoa(JSON.stringify({ exp: 4102444800, userId: 'recovery-user' }))}.signature`
      )
  })
  mockApi(({ method, path }) => {
    if (method === 'GET' && path === '/release.json')
      return { status: 200, body: { version: 'build-a' } }
    if (method === 'GET' && path === '/test-api/sleep-records')
      return { status: 500, body: { code: 'INTERNAL_ERROR' } }
    if (method === 'GET' && path === '/test-api/habits') return { status: 200, body: [] }
    return unexpectedRequest(`${method} ${path}`)
  })
  const reload = vi.fn()
  vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
  await openApp(<MainPage />)
  expect(
    await screen.findByText('Что-то идёт не так, обновите страницу или попробуйте позже')
  ).toBeVisible()
  expect(reload).not.toHaveBeenCalled()
})

test.each(['отметка', 'сон'])(
  'отказ сохранения: %s запускает обновление и не повторяет команду после reload',
  async (kind) => {
    vi.useRealTimers()
    browserWorker()
    const scrollIntoView = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'scrollIntoView'
    )
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    onTestFinished(() => {
      if (scrollIntoView)
        Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoView)
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    })
    await act(async () => {
      useSession
        .getState()
        .login(
          `header.${btoa(JSON.stringify({ exp: 4102444800, userId: 'save-user' }))}.signature`
        )
    })
    let published = 'build-a'
    let commands = 0
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
              createdAt: '2026-10-01T00:00:00Z',
              startDate: '2026-10-01',
              archived: false,
            },
          ] satisfies ApiSchemas['HabitDefinition'][],
        }
      if (method === 'GET' && path === '/test-api/sleep-records')
        return { status: 200, body: [] }
      if (
        (kind === 'отметка' &&
          method === 'PATCH' &&
          /^\/test-api\/sleep-records\/\d{4}-\d{2}-\d{2}\/habits\/reading$/.test(path)) ||
        (kind === 'сон' &&
          method === 'PUT' &&
          /^\/test-api\/sleep-records\/\d{4}-\d{2}-\d{2}$/.test(path))
      ) {
        commands++
        return {
          status: 500,
          body: { code: 'SAVE_FAILED', message: 'Не удалось сохранить' },
        }
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
    published = 'build-b'
    const user = userEvent.setup()
    if (kind === 'отметка') {
      await user.click(
        within(row).getAllByRole('button', { name: 'Не отмечено' }).at(-1)!
      )
    } else {
      await user.click(
        within(screen.getByRole('row', { name: /Дневной сон/ }))
          .getAllByRole('button')
          .at(-1)!
      )
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: '0:30' })
      )
    }
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(commands).toBe(1)
    oldPage.unmount()
    queryClient.clear()
    vi.stubEnv('VITE_BUILD_ID', 'build-b')
    await openApp(<MainPage />)
    await screen.findByRole('row', { name: /Чтение/ })
    expect(commands).toBe(1)
  }
)

test.each(['авторизация', 'ввод', 'сеть'])(
  'штатная ошибка: %s сохраняет форму входа',
  async (kind) => {
    vi.useRealTimers()
    mockApi(({ method, path }) => {
      if (method === 'GET' && path === '/release.json')
        return { status: 200, body: { version: 'build-a' } }
      if (method === 'POST' && path === '/test-api/auth/login') {
        if (kind === 'сеть') throw new TypeError('Failed to fetch')
        return {
          status: kind === 'ввод' ? 400 : 401,
          body: {
            code: kind === 'ввод' ? 'BAD_REQUEST' : 'UNAUTHORIZED',
            message: 'Проверьте данные входа',
          },
        }
      }
      return unexpectedRequest(`${method} ${path}`)
    })
    await openApp(<LoginPage />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email', { exact: true }), 'user@example.test')
    await user.type(screen.getByLabelText('Пароль', { exact: true }), 'password123')
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(
      await screen.findByText(
        kind === 'сеть' ? 'Failed to fetch' : 'Проверьте данные входа'
      )
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Войти' })).toBeVisible()
    expect(screen.queryByText(errorMessage)).not.toBeInTheDocument()
  }
)

test.each(['проверка', 'подготовка', 'хранилище'])(
  'ошибка восстановления: %s оставляет ручной повтор доступным',
  async (stage) => {
    vi.useRealTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { registration } = browserWorker()
    const reload = vi.fn()
    vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
    let failed = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        if (input === '/release.json')
          return new Response(
            JSON.stringify({
              version: failed && stage !== 'проверка' ? 'build-b' : 'build-a',
            }),
            { status: failed && stage === 'проверка' ? 503 : 200 }
          )
        if (input === '/index.html')
          return new Response('<meta name="app-version" content="build-b">')
        return unexpectedRequest(String(input))
      })
    )
    if (stage === 'подготовка')
      registration.update.mockRejectedValue(new Error('Не удалось установить'))
    const storage =
      stage === 'хранилище'
        ? vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('Storage blocked')
          })
        : undefined
    await openApp(<BrokenPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Сломать страницу' }))
    expect(await screen.findByText(errorMessage)).toBeVisible()
    expect(reload).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Обновить страницу' }))
    expect(await screen.findByText(errorMessage)).toBeVisible()
    expect(reload).not.toHaveBeenCalled()
    failed = false
    storage?.mockRestore()
    await userEvent.click(screen.getByRole('button', { name: 'Обновить страницу' }))
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  }
)

test('неожиданный отказ обновления токена до монтирования оболочки достигает экрана ошибки', async () => {
  vi.useRealTimers()
  vi.stubGlobal(
    'AbortController',
    vi.fn(() => transferableAbortController())
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await act(async () => {
    useSession
      .getState()
      .login(
        `header.${btoa(JSON.stringify({ exp: 1, userId: 'expired-user' }))}.signature`
      )
  })
  mockApi(({ method, path }) => {
    if (method === 'GET' && path === '/release.json')
      return { status: 200, body: { version: 'build-a' } }
    if (method === 'POST' && path === '/test-api/auth/refresh')
      return { status: 500, body: { code: 'INTERNAL_ERROR' } }
    return unexpectedRequest(`${method} ${path}`)
  })
  const router = createMemoryRouter([
    createApplicationRoute([
      { path: '*', loader: protectedLoader, element: <h1>Рабочая страница</h1> },
    ]),
  ])
  onTestFinished(() => router.dispose())
  render(<RouterProvider router={router} />)
  expect(await screen.findByText(errorMessage)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Обновить страницу' })).toBeVisible()
})

test('поздний отказ мутации прежней сессии не закрывает интерфейс нового пользователя', async () => {
  vi.useRealTimers()
  const login = (userId: string) =>
    useSession
      .getState()
      .login(`header.${btoa(JSON.stringify({ exp: 4102444800, userId }))}.signature`)
  await act(async () => {
    login('alice')
  })
  let rejectMark!: (response: { status: number; body: ApiSchemas['ApiError'] }) => void
  const mark = new Promise<{ status: number; body: ApiSchemas['ApiError'] }>(
    (resolve) => {
      rejectMark = resolve
    }
  )
  mockApi(({ method, path }) => {
    if (method === 'GET' && path === '/release.json')
      return { status: 200, body: { version: 'build-a' } }
    if (method === 'GET' && path === '/test-api/habits')
      return {
        status: 200,
        body: [
          {
            key: 'reading',
            label: 'Чтение',
            createdAt: '2026-10-01T00:00:00Z',
            startDate: '2026-10-01',
            archived: false,
          },
        ] satisfies ApiSchemas['HabitDefinition'][],
      }
    if (method === 'GET' && path === '/test-api/sleep-records')
      return { status: 200, body: [] }
    if (
      method === 'PATCH' &&
      /^\/test-api\/sleep-records\/\d{4}-\d{2}-\d{2}\/habits\/reading$/.test(path)
    )
      return mark
    return unexpectedRequest(`${method} ${path}`)
  })
  await openApp(<MainPage />)
  const row = await screen.findByRole('row', { name: /Чтение/ })
  await userEvent.click(
    within(row).getAllByRole('button', { name: 'Не отмечено' }).at(-1)!
  )
  await act(async () => {
    useSession.getState().logout()
    login('bob')
  })
  await screen.findByRole('row', { name: /Чтение/ })
  await act(async () => {
    rejectMark({
      status: 500,
      body: { code: 'SAVE_FAILED', message: 'Ошибка старого запроса' },
    })
  })
  expect(screen.getByRole('row', { name: /Чтение/ })).toBeVisible()
  expect(screen.queryByText(errorMessage)).not.toBeInTheDocument()
})

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
})

test('снимает защиту от повторного перезапуска только после смены сборки и загрузки данных страницы', async () => {
  browserWorker()
  const reload = vi.fn()
  vi.stubGlobal('location', { href: location.href, origin: location.origin, reload })
  let published = 'build-b'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      if (input === '/release.json')
        return new Response(JSON.stringify({ version: published }))
      if (input === '/index.html')
        return new Response(`<meta name="app-version" content="${published}">`)
      return unexpectedRequest(String(input))
    })
  )
  const oldPage = await openApp()
  expect(reload).toHaveBeenCalledTimes(1)
  oldPage.unmount()

  // Reloading the same JavaScript must not permit another automatic reload.
  const sameBuild = await openApp()
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
  published = 'build-c'
  await act(() => vi.advanceTimersByTimeAsync(interval))
  expect(reload).toHaveBeenCalledTimes(1)
  await act(async () => {
    resolveData('Данные восстановлены')
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(screen.getByRole('heading')).toHaveTextContent('Данные восстановлены')
  await act(() => vi.advanceTimersByTimeAsync(interval))
  expect(reload).toHaveBeenCalledTimes(2)
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
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

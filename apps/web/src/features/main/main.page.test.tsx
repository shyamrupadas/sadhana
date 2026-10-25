import dayjs from 'dayjs'
import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ApiSchemas } from '@sadhana/api-contract'
import { afterEach, expect, test } from 'vitest'

import { useSession } from '@/shared/model/session'
import { mockApi, renderWithTestProviders } from '@/shared/test/harness'
import { Component as MainPage } from './main.page'

afterEach(() => useSession.getState().logout())

test('возвращает отметку к прежнему состоянию после отказа сохранения', async () => {
  const token = `header.${btoa(JSON.stringify({ exp: 4_102_444_800, userId: 'user-1' }))}.signature`
  useSession.getState().login(token)

  const habit = {
    key: 'reading',
    label: 'Чтение',
    createdAt: '2026-10-01T00:00:00.000Z',
  } satisfies ApiSchemas['HabitDefinition']
  const unexpected: string[] = []
  let failedMarkRequested = false
  let rejectMark!: (response: { status: number; body: ApiSchemas['ApiError'] }) => void
  const rejectedMark = new Promise<{ status: number; body: ApiSchemas['ApiError'] }>(
    (resolve) => {
      rejectMark = resolve
    }
  )
  mockApi(({ method, path }) => {
    if (method === 'GET' && path === '/test-api/habits') {
      return { status: 200, body: [habit] }
    }
    if (method === 'GET' && path === '/test-api/sleep-records') {
      return { status: 200, body: [] }
    }
    if (
      method === 'PATCH' &&
      /^\/test-api\/sleep-records\/\d{4}-\d{2}-\d{2}\/habits\/reading$/.test(path)
    ) {
      failedMarkRequested = true
      return rejectedMark
    }

    unexpected.push(`${method} ${path}`)
    throw new Error(`Неожиданный API-запрос: ${method} ${path}`)
  })

  renderWithTestProviders(<MainPage />)

  const row = await screen.findByRole('row', { name: /Чтение/ })
  const mark = within(row).getAllByRole('button', { name: 'Не отмечено' }).at(-1)!
  await userEvent.click(mark)

  await waitFor(() => expect(failedMarkRequested).toBe(true))
  expect(mark).toHaveAccessibleName('Выполнено')
  rejectMark({ status: 500, body: { code: 'SAVE_FAILED', message: 'Не сохранено' } })
  await waitFor(() => expect(mark).toHaveAccessibleName('Не отмечено'))
  expect(unexpected).toEqual([])
})

test('поздний отказ отметки не возвращает приватные записи после смены сессии', async () => {
  const login = (userId: string) =>
    useSession
      .getState()
      .login(`header.${btoa(JSON.stringify({ exp: 4102444800, userId }))}.signature`)
  login('alice')
  const date = dayjs().format('YYYY-MM-DD')
  const entry = (wakeTime: string): ApiSchemas['DailyEntry'] => ({
    id: date,
    date,
    sleep: {
      bedtime: null,
      wakeTime: `${date} ${wakeTime}`,
      napDuration: null,
      duration: null,
    },
    habits: [],
  })
  let owner = 'alice'
  let rejectMark!: (response: { status: number; body: object }) => void
  const pending = new Promise<{ status: number; body: object }>((resolve) => {
    rejectMark = resolve
  })
  let markStarted = false
  mockApi(({ method, path }) => {
    if (method === 'GET' && path === '/test-api/habits')
      return {
        status: 200,
        body: [{ key: 'read', label: 'Чтение', createdAt: '2026-01-01T00:00:00Z' }] satisfies ApiSchemas['HabitDefinition'][],
      }
    if (method === 'GET' && path === '/test-api/sleep-records')
      return { status: 200, body: [entry(owner === 'alice' ? '06:00' : '09:00')] }
    if (method === 'PATCH' && path === `/test-api/sleep-records/${date}/habits/read`) {
      markStarted = true
      return pending
    }
    throw new Error(`Unexpected ${method} ${path}`)
  })
  let cache!: QueryClient
  function CacheAccess() {
    cache = useQueryClient()
    return null
  }
  renderWithTestProviders(
    <>
      <MainPage />
      <CacheAccess />
    </>
  )
  const mark = within(await screen.findByRole('row', { name: /Чтение/ }))
    .getAllByRole('button', { name: 'Не отмечено' })
    .at(-1)!
  await userEvent.click(mark)
  await waitFor(() => expect(markStarted).toBe(true))
  owner = 'bob'
  await act(async () => {
    useSession.getState().logout()
    login('bob')
  })
  await screen.findByRole('button', { name: '09:00' })
  // Simulate the same private-cache cleanup used by the application provider.
  cache.removeQueries({ queryKey: ['get', '/sleep-records', 'alice'] })
  const leaked: boolean[] = []
  const unsubscribe = cache.getQueryCache().subscribe((event) => {
    if (JSON.stringify(event.query.state.data)?.includes('06:00')) leaked.push(true)
  })
  await act(async () => {
    rejectMark({ status: 500, body: { code: 'FAIL', message: 'Failed' } })
    await pending
  })
  await waitFor(() => expect(cache.isMutating()).toBe(0))
  unsubscribe()
  expect(leaked).toEqual([])
  expect(cache.getQueryData(['get', '/sleep-records', 'alice'])).toBeUndefined()
  expect(screen.queryByRole('button', { name: '06:00' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '09:00' })).toBeVisible()
})

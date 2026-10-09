import { screen, waitFor, within } from '@testing-library/react'
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

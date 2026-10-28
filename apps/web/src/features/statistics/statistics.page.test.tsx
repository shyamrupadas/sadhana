import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { afterEach, expect, test, vi } from 'vitest'
import type { ApiSchemas } from '@sadhana/api-contract'
import { useSession } from '@/shared/model/session'
import { mockApi, renderWithTestProviders } from '@/shared/test/harness'
import { Component as StatisticsPage } from '@/features/statistics/statistics.page'

afterEach(() => {
  useSession.getState().logout()
  vi.useRealTimers()
})
const login = (userId = 'alice') =>
  useSession
    .getState()
    .login(`header.${btoa(JSON.stringify({ exp: 4102444800, userId }))}.signature`)
const sample = (value: number | null) => ({
  value,
  sum: value ?? 0,
  count: value === null ? 0 : 1,
})

function response(query: URLSearchParams): ApiSchemas['StatisticsData'] {
  const date = query.get('asOfDate')!
  return {
    granularity: query.get('granularity') as ApiSchemas['StatisticsData']['granularity'],
    from: query.get('from')!,
    toExclusive: query.get('toExclusive')!,
    asOfDate: date,
    historyFrom: date,
    habits: [],
    columns: [
      {
        from: query.get('granularity') === 'week'
          ? dayjs(date).subtract((dayjs(date).day() + 6) % 7, 'day').format('YYYY-MM-DD')
          : query.get('granularity') === 'day' ? date : date.slice(0, 7) + '-01',
        toExclusive: query.get('toExclusive')!,
        habits: [],
        bedtime: sample(0),
        wakeTime: sample(420),
        nap: sample(0),
        duration: sample(480),
      },
    ],
  }
}

test('statistics retries an HTTP error, formats sleep and switches calendar scales', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'))
  login()
  let fail = true
  const calls: string[] = []
  mockApi(({ method, path }) => {
    const url = new URL(path, 'https://example.test')
    if (method !== 'GET' || url.pathname !== '/test-api/statistics')
      throw new Error(`Unexpected ${method} ${path}`)
    calls.push(path)
    return fail
      ? { status: 503, body: { code: 'UNAVAILABLE', message: 'Retry' } }
      : { status: 200, body: response(url.searchParams) }
  })
  renderWithTestProviders(<StatisticsPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить')
  fail = false
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  const wake = await screen.findByRole('row', { name: /Подъём/ })
  expect(within(wake).getByText('07:00')).toBeVisible()
  expect(
    within(screen.getByRole('row', { name: /Сон \(итого\)/ })).getByText('8:00')
  ).toBeVisible()
  expect(
    within(screen.getByRole('row', { name: /Отбой/ })).getByText('00:00')
  ).toBeVisible()
  expect(
    within(screen.getByRole('row', { name: /Дневной сон/ })).getByText('—')
  ).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Недели' }))
  const weekStart = dayjs().subtract((dayjs().day() + 6) % 7, 'day')
  const weekHeader = await screen.findByRole('button', { name: weekStart.format('YYYY-MM-DD') })
  expect(weekHeader).toHaveTextContent('26–1 окт*')
  await userEvent.click(screen.getByRole('button', { name: 'Месяцы' }))
  await waitFor(() =>
    expect(calls.some((path) => path.includes('granularity=month'))).toBe(true)
  )
  expect(await screen.findByRole('button', { name: '2026-10-01' })).toHaveTextContent('окт 2026')
})

test('a late private response cannot replace the next account statistics', async () => {
  login()
  let resolveOld!: (value: { status: number; body: ApiSchemas['StatisticsData'] }) => void
  let oldQuery!: URLSearchParams
  const pending = new Promise<{ status: number; body: ApiSchemas['StatisticsData'] }>(
    (resolve) => {
      resolveOld = resolve
    }
  )
  let requests = 0
  mockApi(({ method, path }) => {
    const url = new URL(path, 'https://example.test')
    if (method !== 'GET' || url.pathname !== '/test-api/statistics')
      throw new Error(`Unexpected ${method} ${path}`)
    if (++requests === 1) {
      oldQuery = url.searchParams
      return pending
    }
    const body = response(url.searchParams)
    body.columns[0].wakeTime = sample(480)
    return { status: 200, body }
  })
  renderWithTestProviders(<StatisticsPage />)
  await waitFor(() => expect(requests).toBe(1))
  await act(async () => login('bob'))
  expect(await screen.findByText('08:00')).toBeVisible()
  await act(async () => {
    const body = response(oldQuery)
    body.columns[0].wakeTime = sample(720)
    resolveOld({ status: 200, body })
  })
  expect(screen.queryByText('12:00')).not.toBeInTheDocument()
  expect(screen.getByText('08:00')).toBeVisible()
})


test('habit rows show day states, aggregate percentages and archived filters without losing the date', async () => {
  login()
  const calls: URLSearchParams[] = []
  mockApi(({ method, path }) => {
    const url = new URL(path, 'https://example.test')
    if (method !== 'GET' || url.pathname !== '/test-api/statistics') throw new Error(`Unexpected ${method} ${path}`)
    calls.push(url.searchParams)
    const body = response(url.searchParams)
    body.habits = [{ key: 'read', label: 'Книги', createdAt: null, startDate: null, archived: false }]
    body.columns[0].habits = [{ habitId: 'read', state: 'failed', successRate: 0.8, completeness: null, trueCount: 4, falseCount: 1, eligibleDayCount: null }]
    if (url.searchParams.get('includeArchived') === 'true') {
      body.habits.push({ key: 'archived', label: 'Архивная', createdAt: null, startDate: null, archived: true })
      body.columns[0].habits.push({ habitId: 'archived', state: 'notApplicable', successRate: null, completeness: null, trueCount: 0, falseCount: 0, eligibleDayCount: null })
    }
    return { status: 200, body }
  })
  renderWithTestProviders(<StatisticsPage />)
  const row = await screen.findByRole('row', { name: /Книги/ })
  expect(within(row).getByLabelText('Не выполнено')).toBeVisible()
  expect(screen.queryByRole('row', { name: /Архивная/ })).not.toBeInTheDocument()
  const dateHeader = screen.getAllByRole('button', { name: /^\d{4}-\d{2}-\d{2}$/ }).at(-1)!.getAttribute('aria-label')!
  await userEvent.click(screen.getByRole('checkbox', { name: 'Показывать архивные' }))
  expect(await screen.findByRole('row', { name: /Архивная/ })).toHaveTextContent('н/а')
  expect(calls.at(-1)?.get('includeArchived')).toBe('true')
  expect(screen.getByRole('button', { name: dateHeader })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Месяцы' }))
  await waitFor(() => expect(screen.getByRole('row', { name: /Книги/ })).toHaveTextContent('80%'))
  expect(screen.getByRole('row', { name: /Архивная/ })).toHaveTextContent('—')
})

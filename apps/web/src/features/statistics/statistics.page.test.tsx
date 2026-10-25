import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'
import type { ApiSchemas } from '@sadhana/api-contract'
import { useSession } from '@/shared/model/session'
import { mockApi, renderWithTestProviders } from '@/shared/test/harness'
import { Component as StatisticsPage } from '@/features/statistics/statistics.page'

afterEach(() => useSession.getState().logout())
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
    columns: [
      {
        from: query.get('granularity') === 'day' ? date : date.slice(0, 7) + '-01',
        toExclusive: query.get('toExclusive')!,
        bedtime: sample(0),
        wakeTime: sample(420),
        nap: sample(0),
        duration: sample(480),
      },
    ],
  }
}

test('statistics retries an HTTP error, formats sleep and switches calendar scales', async () => {
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
  await userEvent.click(screen.getByRole('button', { name: 'Месяцы' }))
  await waitFor(() =>
    expect(calls.some((path) => path.includes('granularity=month'))).toBe(true)
  )
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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { FastifyInstance } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import statisticsRoutes from '../../src/routes/statistics'
import { createApiHandlers } from '../../src/api-handlers'
import { ApiClient } from '@sadhana/api-contract'

type Row = {
  userId: string
  date: string
  bedtime: string | null
  wake_time: string | null
  nap_minutes: number | null
}

async function makeApp(rows: Row[]) {
  const app = Fastify()
  const reads: unknown[][] = []
  app.decorate('pg', {
    connect: async () => ({
      query: async (sql: string, values: string[]) => {
        reads.push(values)
        const own = rows.filter((row) => row.userId === values[0])
        if (sql.includes('min(date)'))
          return {
            rows: [
              {
                history_from:
                  own
                    .filter(
                      (row) => row.bedtime || row.wake_time || (row.nap_minutes ?? 0) > 0
                    )
                    .map((row) => row.date)
                    .filter((date) => date <= values[1])
                    .sort()[0] ?? null,
              },
            ],
          }
        if (sql.includes('FROM sleep_records'))
          return {
            rows: own.filter((row) => row.date >= values[1] && row.date < values[2]),
          }
        throw new Error(`Unexpected SQL ${sql}`)
      },
      release() {},
    }),
  } as unknown as FastifyInstance['pg'])
  await app.register(fastifyJwt, { secret: 'test-secret' })
  app.decorate('apiHandlers', createApiHandlers(app))
  await app.register(statisticsRoutes, { prefix: '/statistics' })
  await app.ready()
  const headers = {
    authorization: `Bearer ${app.jwt.sign({ userId: 'alice', email: 'alice@example.test', type: 'access' })}`,
  }
  const client = new ApiClient({
    fetch: async (input) => {
      const response = await app.inject({ method: 'GET', url: String(input), headers })
      return new Response(response.body, { status: response.statusCode })
    },
  })
  return { app, headers, client, reads }
}

const fact = (date: string, overrides: Partial<Row> = {}): Row => ({
  userId: 'alice',
  date,
  bedtime: null,
  wake_time: null,
  nap_minutes: null,
  ...overrides,
})

test('calendar statistics calculate independent sleep samples through authenticated HTTP', async (t) => {
  const { app, client, reads } = await makeApp([
    fact('2026-10-04', { bedtime: '2026-10-04 23:00', nap_minutes: 1000 }),
    fact('2026-10-05', {
      bedtime: '2026-10-05 23:00',
      wake_time: '2026-10-05 11:00',
      nap_minutes: 30,
    }),
    fact('2026-10-06', {
      bedtime: '2026-10-07 01:00',
      wake_time: '2026-10-06 13:00',
      nap_minutes: 60,
    }),
    fact('2026-10-08', { wake_time: '2026-10-08 08:00' }),
    fact('2026-10-05', {
      userId: 'bob',
      wake_time: '2026-10-05 23:00',
      nap_minutes: 9999,
    }),
    fact('2026-10-12', { nap_minutes: 9999 }),
  ])
  t.after(() => app.close())
  assert.equal((await app.inject('/statistics')).statusCode, 401)
  const result = await client.getStatistics({
    granularity: 'week',
    from: '2026-10-05',
    toExclusive: '2026-10-12',
    asOfDate: '2026-10-11',
  })
  assert.equal(result.historyFrom, '2026-10-04')
  assert.equal(result.columns.length, 1)
  const column = result.columns[0]
  assert.deepEqual(column.bedtime, { value: 0, sum: 2880, count: 2 })
  assert.deepEqual(column.wakeTime, { value: 640, sum: 1920, count: 3 })
  assert.deepEqual(column.nap, { value: 13, sum: 90, count: 7 })
  assert.deepEqual(column.duration, { value: 825, sum: 1650, count: 2 })
  assert.deepEqual(reads[0], ['alice', '2026-10-04', '2026-10-12'])
  assert.equal(reads.length, 2)
})

test('statistics validate real dates, calendar alignment and each block limit before reading', async (t) => {
  const { app, headers, client, reads } = await makeApp([])
  t.after(() => app.close())
  for (const [granularity, from, toExclusive, expected] of [
    ['day', '2026-01-01', '2026-02-18', 200],
    ['day', '2026-01-01', '2026-02-19', 400],
    ['week', '2026-01-05', '2026-06-22', 200],
    ['week', '2026-01-05', '2026-06-29', 400],
    ['week', '2026-01-06', '2026-01-13', 400],
    ['month', '2025-01-01', '2026-01-01', 200],
    ['month', '2025-01-01', '2026-02-01', 400],
    ['month', '2026-02-30', '2026-04-01', 400],
    ['year', '2024-01-01', '2028-01-01', 200],
    ['year', '2023-01-01', '2028-01-01', 400],
    ['day', '2026-05-02', '2026-05-01', 400],
    ['day', '2028-01-01', '2028-01-02', 400],
  ] as const) {
    const before = reads.length
    const response = await app.inject({
      url: `/statistics?${new URLSearchParams({ granularity, from, toExclusive, asOfDate: '2026-10-10' })}`,
      headers,
    })
    assert.equal(response.statusCode, expected, `${granularity} ${from} ${toExclusive}`)
    if (expected === 400) assert.equal(reads.length, before)
  }
  const partial = await client.getStatistics({
    granularity: 'month',
    from: '2024-02-01',
    toExclusive: '2024-03-01',
    asOfDate: '2024-02-29',
  })
  assert.equal(partial.columns[0].nap.count, 29)
  assert.equal(partial.historyFrom, '2024-02-29')
  const device = await client.getStatistics({
    granularity: 'week',
    from: '2026-10-05',
    toExclusive: '2026-10-12',
    asOfDate: '2026-10-06',
  })
  assert.equal(device.toExclusive, '2026-10-07')
  assert.equal(device.columns[0].nap.count, 2)
  assert.deepEqual(device.columns[0].duration, { value: null, sum: 0, count: 0 })
})

test('day statistics use exact previous calendar date and arithmetic wake time across noon', async (t) => {
  const { app, client } = await makeApp([
    fact('2026-09-30', { bedtime: '2026-09-30 23:00' }),
    fact('2026-10-01', { wake_time: '2026-10-01 00:00' }),
    fact('2026-10-03', { wake_time: '2026-10-03 12:00', nap_minutes: 60 }),
    fact('2026-10-04', { nap_minutes: 9999 }),
  ])
  t.after(() => app.close())
  const days = await client.getStatistics({
    granularity: 'day',
    from: '2026-10-01',
    toExclusive: '2026-10-05',
    asOfDate: '2026-10-03',
  })
  assert.deepEqual(
    days.columns.map((column) => [column.from, column.duration.value]),
    [
      ['2026-10-01', 60],
      ['2026-10-02', null],
      ['2026-10-03', null],
    ]
  )
  assert.equal(days.columns[2].source?.wakeTime, '2026-10-03 12:00')
  const months = await client.getStatistics({
    granularity: 'month',
    from: '2026-10-01',
    toExclusive: '2026-11-01',
    asOfDate: '2026-10-03',
  })
  assert.equal(months.columns[0].wakeTime.value, 360)
  assert.equal(months.columns[0].nap.value, 20)
  assert.equal(months.columns[0].bedtime.value, null)
})

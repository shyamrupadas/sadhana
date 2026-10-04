import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { FastifyInstance } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { ApiClient } from '@sadhana/api-contract'
import sleepStatsRoutes from '../../src/routes/sleep-stats'

type Row = {
  id: string
  date: string
  userId: string
  sleep_data: { bedtime: string | null; wakeTime: string | null; napDuration: number | null; duration: number | null }
  habits: []
}

const emptySleep = { bedtime: null, wakeTime: null, napDuration: null, duration: null }
const emptyPeriod = { bedtime: null, wakeTime: null, duration: null }

function sleepPair(userId: string, date: string, previousDate: string, wakeTime: string): Row[] {
  return [
    { id: date, date, userId, sleep_data: { ...emptySleep, bedtime: `${date} 23:00`, wakeTime: `${date} ${wakeTime}` }, habits: [] },
    { id: previousDate, date: previousDate, userId, sleep_data: { ...emptySleep, bedtime: `${previousDate} 23:00` }, habits: [] },
  ]
}

async function makeApp(rows: Row[]) {
  const app = Fastify()
  app.decorate('pg', {
    connect: async () => ({
      query: async (sql: string, params: string[]) => {
        if (sql.includes('ORDER BY date DESC')) {
          return { rows: rows.filter((row) => row.userId === params[0]).sort((a, b) => b.date.localeCompare(a.date)) }
        }
        return { rows: rows.filter((row) => row.userId === params[0] && row.date === params[1]) }
      },
      release: () => undefined,
    }),
  } as unknown as FastifyInstance['pg'])
  await app.register(fastifyJwt, { secret: 'test-secret' })
  await app.register(sleepStatsRoutes, { prefix: '/sleep-stats' })
  await app.ready()
  const auth = (userId: string) => ({ authorization: `Bearer ${app.jwt.sign({ userId, email: `${userId}@example.test`, type: 'access' })}` })
  return { app, auth }
}

test('sleep statistics preserve nullable empty periods and authorized response shape', async (t) => {
  const { app, auth } = await makeApp([])
  t.after(() => app.close())
  assert.equal((await app.inject({ method: 'GET', url: '/sleep-stats' })).statusCode, 401)
  const response = await app.inject({ method: 'GET', url: '/sleep-stats', headers: auth('alice') })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { week: emptyPeriod, month: emptyPeriod, year: emptyPeriod })
})

test('sleep statistics use Moscow week, month and completed-year windows through generated client', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T21:30:00.000Z') })
  const rows = [
    ...sleepPair('alice', '2026-10-04', '2026-10-03', '07:00'),
    ...sleepPair('alice', '2026-09-20', '2026-09-19', '08:00'),
    ...sleepPair('alice', '2026-08-15', '2026-08-14', '06:00'),
    ...sleepPair('bob', '2026-10-04', '2026-10-03', '12:00'),
  ]
  const { app, auth } = await makeApp(rows)
  t.after(() => app.close())
  const response = await app.inject({ method: 'GET', url: '/sleep-stats', headers: auth('alice') })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    week: { bedtime: '23:00', wakeTime: '07:00', duration: '8:00' },
    month: { bedtime: '23:00', wakeTime: '07:30', duration: '8:30' },
    year: { bedtime: '23:00', wakeTime: '07:00', duration: '8:00' },
  })

  const client = new ApiClient({ fetch: async (input) => {
    const result = await app.inject({ method: 'GET', url: String(input), headers: auth('alice') })
    return new Response(result.body, { status: result.statusCode })
  } })
  assert.deepEqual(await client.getSleepStats(), response.json())
})

test('sleep statistics include calendar boundaries and exclude the adjacent dates', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T21:30:00.000Z') })
  const rows: Row[] = []
  const { app, auth } = await makeApp(rows)
  t.after(() => app.close())

  const cases: Array<[string, string, [boolean, boolean, boolean]]> = [
    ['2026-09-28', '2026-09-27', [true, true, true]],
    ['2026-09-27', '2026-09-26', [false, true, true]],
    ['2026-09-05', '2026-09-04', [false, true, true]],
    ['2026-09-04', '2026-09-03', [false, false, true]],
    ['2025-10-01', '2025-09-30', [false, false, true]],
    ['2025-09-30', '2025-09-29', [false, false, false]],
    ['2026-09-30', '2026-09-29', [true, true, true]],
    ['2026-10-01', '2026-09-30', [true, true, false]],
  ]
  for (const [date, previousDate, expected] of cases) {
    rows.splice(0, rows.length, ...sleepPair('alice', date, previousDate, '07:00'))
    const response = await app.inject({ method: 'GET', url: '/sleep-stats', headers: auth('alice') })
    assert.equal(response.statusCode, 200)
    const stats = response.json()
    assert.deepEqual(['week', 'month', 'year'].map((period) => stats[period].duration !== null), expected, date)
  }
})

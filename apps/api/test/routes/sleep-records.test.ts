import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { FastifyInstance } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { ApiClient, ApiClientError } from '@sadhana/api-contract'
import sleepRecordsRoutes from '../../src/routes/sleep-records'

dayjs.extend(utc)
dayjs.extend(timezone)

type Row = {
  id: string
  userId: string
  date: string
  sleep_data: { bedtime: string | null; wakeTime: string | null; napDuration: number | null; duration: number | null } | null
  habits: { key: string; value: boolean }[]
}

const emptySleep = { bedtime: null, wakeTime: null, napDuration: null, duration: null }

async function makeApp(rows: Row[]) {
  const app = Fastify()
  app.decorate('pg', {
    connect: async () => ({
      query: async (sql: string, params: unknown[] = []) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] }
        const userId = String(params[0])
        if (sql.includes('ORDER BY date DESC')) {
          return { rows: rows.filter((row) => row.userId === userId && row.date >= String(params[1]) && row.date <= String(params[2])).sort((a, b) => b.date.localeCompare(a.date)) }
        }
        if (sql.startsWith('SELECT')) {
          return { rows: rows.filter((row) => row.userId === userId && row.date === params[1]) }
        }
        if (sql.includes('INSERT INTO daily_entries')) {
          const [, owner, date, sleepJson, habitsJson] = params as string[]
          let row = rows.find((item) => item.userId === owner && item.date === date)
          if (!row) {
            row = { id: String(params[0]), userId: owner, date, sleep_data: null, habits: [] }
            rows.push(row)
          }
          row.sleep_data = JSON.parse(sleepJson)
          row.habits = JSON.parse(habitsJson)
          return { rows: [row] }
        }
        if (sql.includes('UPDATE daily_entries')) {
          const habitUpdate = sql.includes('SET habits =')
          const row = rows.find((item) => item.userId === params[habitUpdate ? 2 : 1] && item.date === params[habitUpdate ? 3 : 2])
          if (row && habitUpdate) {
            row.habits = JSON.parse(String(params[0]))
            row.sleep_data = JSON.parse(String(params[1]))
          } else if (row) row.sleep_data = JSON.parse(String(params[0]))
          return { rows: row ? [row] : [] }
        }
        throw new Error(`Unexpected query: ${sql}`)
      },
      release: () => undefined,
    }),
  } as unknown as FastifyInstance['pg'])
  await app.register(fastifyJwt, { secret: 'test-secret' })
  await app.register(sleepRecordsRoutes, { prefix: '/sleep-records' })
  await app.ready()
  const auth = (userId: string) => ({ authorization: `Bearer ${app.jwt.sign({ userId, email: `${userId}@example.test`, type: 'access' })}` })
  return { app, auth }
}

test('sleep records list covers only five Moscow dates and each user sees their own records', async (t) => {
  const today = dayjs().tz('Europe/Moscow')
  const date = (daysAgo: number) => today.subtract(daysAgo, 'day').format('YYYY-MM-DD')
  const rows: Row[] = Array.from({ length: 6 }, (_, daysAgo) => ({
    id: `alice-${date(daysAgo)}`, userId: 'alice', date: date(daysAgo), sleep_data: emptySleep, habits: [],
  }))
  rows.push({ id: `bob-${date(0)}`, userId: 'bob', date: date(0), sleep_data: emptySleep, habits: [] })
  const { app, auth } = await makeApp(rows)
  t.after(() => app.close())

  assert.equal((await app.inject({ method: 'GET', url: '/sleep-records' })).statusCode, 401)
  const response = await app.inject({ method: 'GET', url: '/sleep-records', headers: auth('alice') })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json().map((entry: { date: string }) => entry.date), [0, 1, 2, 3, 4].map(date))
  assert.equal((await app.inject({ method: 'GET', url: '/sleep-records', headers: auth('bob') })).json().length, 1)
})

test('daily habit marks create a day, accept unknown keys, change values and remove marks', async (t) => {
  const { app, auth } = await makeApp([])
  t.after(() => app.close())
  const url = '/sleep-records/2026-10-02/habits/unknown'
  const headers = auth('alice')

  assert.equal((await app.inject({ method: 'PATCH', url, payload: { value: true } })).statusCode, 401)
  const first = await app.inject({ method: 'PATCH', url, headers, payload: { value: true } })
  assert.equal(first.statusCode, 200)
  assert.deepEqual(first.json(), { id: '2026-10-02', date: '2026-10-02', sleep: emptySleep, habits: [{ key: 'unknown', value: true }] })
  const changed = await app.inject({ method: 'PATCH', url, headers, payload: { value: false } })
  assert.equal(changed.statusCode, 200)
  assert.deepEqual(changed.json().habits, [{ key: 'unknown', value: false }])
  assert.equal((await app.inject({ method: 'GET', url: '/sleep-records/2026-10-02', headers })).json().habits[0].value, false)
  const missingDay = await app.inject({ method: 'DELETE', url, headers: auth('bob') })
  assert.equal(missingDay.statusCode, 404)
  assert.deepEqual(missingDay.json(), { message: 'Daily entry not found', code: 'NOT_FOUND' })
  const removed = await app.inject({ method: 'DELETE', url, headers })
  assert.equal(removed.statusCode, 200)
  assert.deepEqual(removed.json().habits, [])
  assert.equal((await app.inject({ method: 'DELETE', url, headers })).statusCode, 200)

  const invalidValue = await app.inject({ method: 'PATCH', url, headers, payload: { value: 'yes' } })
  assert.equal(invalidValue.statusCode, 500)
  assert.deepEqual(invalidValue.json(), { message: 'Internal Server Error', code: 'INTERNAL_ERROR' })
})

test('generated client can change and remove marks through the existing HTTP routes', async (t) => {
  const { app, auth } = await makeApp([])
  t.after(() => app.close())
  const client = new ApiClient({ fetch: async (input, init) => {
    const headers = new Headers(init?.headers)
    const response = await app.inject({
      method: init?.method as 'GET' | 'PATCH' | 'DELETE',
      url: String(input),
      headers: { authorization: auth('alice').authorization, 'content-type': headers.get('content-type') ?? undefined },
      payload: init?.body as string | undefined,
    })
    return new Response(response.body, { status: response.statusCode })
  } })

  const created = await client.setDailyHabitMark('2026-10-02', 'unknown', { value: true })
  assert.deepEqual(created.habits, [{ key: 'unknown', value: true }])
  assert.deepEqual((await client.getSleepRecords()).map((entry) => entry.date), ['2026-10-02'])
  assert.deepEqual((await client.setDailyHabitMark('2026-10-02', 'unknown', { value: false })).habits, [{ key: 'unknown', value: false }])
  assert.deepEqual((await client.removeDailyHabitMark('2026-10-02', 'unknown')).habits, [])
  await assert.rejects(client.removeDailyHabitMark('2026-10-03', 'unknown'), (error) => {
    assert.ok(error instanceof ApiClientError)
    assert.equal(error.status, 404)
    return true
  })
})

test('sleep record create and read preserve missing times, zero nap, duration, and missing date responses', async (t) => {
  const { app, auth } = await makeApp([])
  t.after(() => app.close())
  const headers = auth('alice')
  const put = (date: string, payload: object) => app.inject({ method: 'PUT', url: `/sleep-records/${date}`, headers, payload })
  const get = (date: string) => app.inject({ method: 'GET', url: `/sleep-records/${date}`, headers })

  const missing = await get('2026-10-01')
  assert.equal(missing.statusCode, 404)
  assert.deepEqual(missing.json(), { message: 'Sleep record not found', code: 'NOT_FOUND' })

  const first = await put('2026-10-01', { bedtime: '2026-10-01 23:00', napDuration: 0 })
  assert.equal(first.statusCode, 200)
  assert.deepEqual(first.json(), {
    id: '2026-10-01', date: '2026-10-01',
    sleep: { bedtime: '2026-10-01 23:00', wakeTime: null, napDuration: null, duration: null }, habits: [],
  })
  assert.deepEqual((await get('2026-10-01')).json(), first.json())

  const second = await put('2026-10-02', { wakeTime: '2026-10-02 07:00', napDuration: null })
  assert.equal(second.statusCode, 200)
  assert.deepEqual(second.json().sleep, { bedtime: null, wakeTime: '2026-10-02 07:00', napDuration: null, duration: 480 })
  assert.equal((await get('2026-10-02')).json().sleep.duration, 480)
  assert.equal((await app.inject({ method: 'GET', url: '/sleep-records/2026-10-02', headers: auth('bob') })).statusCode, 404)

  const invalid = await put('2026-10-03', {})
  assert.equal(invalid.statusCode, 500)
  assert.deepEqual(invalid.json(), { message: 'Internal Server Error', code: 'INTERNAL_ERROR' })
})

test('yesterday check uses the two Moscow calendar dates and the generated client preserves its response', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-01T21:30:00.000Z') })
  const rows: Row[] = [
    { id: '2026-03-01', userId: 'alice', date: '2026-03-01', sleep_data: { ...emptySleep, wakeTime: '2026-03-01 07:00' }, habits: [] },
    { id: '2026-02-28', userId: 'alice', date: '2026-02-28', sleep_data: { ...emptySleep, bedtime: '2026-02-28 23:00' }, habits: [] },
    { id: '2026-03-01', userId: 'bob', date: '2026-03-01', sleep_data: { ...emptySleep, wakeTime: '2026-03-01 07:00' }, habits: [] },
  ]
  const { app, auth } = await makeApp(rows)
  t.after(() => app.close())
  const url = '/sleep-records/yesterday/check'

  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401)
  assert.deepEqual((await app.inject({ method: 'GET', url, headers: auth('alice') })).json(), { hasData: true })
  assert.deepEqual((await app.inject({ method: 'GET', url, headers: auth('bob') })).json(), { hasData: false })

  const client = new ApiClient({ fetch: async (input) => {
    const response = await app.inject({ method: 'GET', url: String(input), headers: auth('alice') })
    return new Response(response.body, { status: response.statusCode })
  } })
  assert.deepEqual(await client.checkYesterday(), { hasData: true })

  rows[1].sleep_data = emptySleep
  assert.deepEqual((await app.inject({ method: 'GET', url, headers: auth('alice') })).json(), { hasData: false })
})

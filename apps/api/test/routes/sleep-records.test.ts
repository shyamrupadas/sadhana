import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { FastifyInstance } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
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
          const row = rows.find((item) => item.userId === params[1] && item.date === params[2])
          if (row) row.sleep_data = JSON.parse(String(params[0]))
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

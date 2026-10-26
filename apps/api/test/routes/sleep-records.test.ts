import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { FastifyInstance } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { ApiClient, ApiClientError } from '@sadhana/api-contract'
import sleepRecordsRoutes from '../../src/routes/sleep-records'
import statisticsRoutes from '../../src/routes/statistics'
import { createApiHandlers } from '../../src/api-handlers'
import { buildDevFixtures } from '../../src/db/dev-fixtures'

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

async function makeApp(rows: Row[], habits: { userId: string; key: string; start_date?: string | null }[] = [{ userId: 'alice', key: 'read' }, { userId: 'alice', key: 'walk' }]) {
  const app = Fastify()
  app.decorate('pg', {
    connect: async () => ({
      query: async (sql: string, params: unknown[] = []) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] }
        const userId = String(params[0])
        if (sql.includes('FROM habits') && sql.includes('FOR KEY SHARE')) return { rows: habits.filter(h => h.userId === params[0] && h.key === params[1]) }
        if (sql.includes('INSERT INTO habit_marks')) {
          let row = rows.find(r => r.userId === userId && r.date === params[1])
          if (!row) { row = { id: `${userId}-${params[1]}`, userId, date: String(params[1]), sleep_data: null, habits: [] }; rows.push(row) }
          row.habits = [...row.habits.filter(h => h.key !== params[2]), { key: String(params[2]), value: Boolean(params[3]) }]
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('DELETE FROM habit_marks')) {
          const row = rows.find(r => r.userId === userId && r.date === params[1])
          if (row) row.habits = row.habits.filter(h => h.key !== params[2])
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('FROM habits')) return { rows: [] }
        if (sql.includes('FROM habit_marks') && !sql.includes('FROM daily_entries d')) return { rows: [] }
        if (sql.includes('min(date)')) return { rows: [{ history_from: rows.filter(row => row.userId === userId && row.date <= String(params[1]) && (row.sleep_data?.bedtime || row.sleep_data?.wakeTime || row.sleep_data?.napDuration)).map(row => row.date).sort()[0] ?? null }] }
        if (sql.includes('FROM sleep_records s')) return { rows: rows.filter(row => row.userId === userId && row.date >= String(params[1]) && row.date < String(params[2])).map(row => ({ date: row.date, bedtime: row.sleep_data?.bedtime, wake_time: row.sleep_data?.wakeTime, nap_minutes: row.sleep_data?.napDuration })) }

        if (sql.startsWith('SELECT') && sql.includes('FROM daily_entries d')) {
          return { rows: rows.filter(row => row.userId === userId && row.date >= String(params[1]) && row.date <= String(params[2])).sort((a, b) => b.date.localeCompare(a.date)).map(row => ({ entry_date: row.date, date: row.date, habits: row.habits, bedtime: row.sleep_data?.bedtime ?? null, wake_time: row.sleep_data?.wakeTime ?? null, nap_minutes: row.sleep_data?.napDuration ?? null })) }
        }
        if (sql.includes('INSERT INTO daily_entries')) {
          const [, owner, date, habitsJson, key] = params as string[]
          let row = rows.find(item => item.userId === owner && item.date === date)
          if (!row) { row = { id: String(params[0]), userId: owner, date, sleep_data: null, habits: [] }; rows.push(row) }
          if (habitsJson) row.habits = [...row.habits.filter(mark => mark.key !== key), ...JSON.parse(habitsJson)]
          return { rows: [row], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO sleep_records')) {
          const row = rows.find(item => item.userId === userId && item.date === params[1])!
          row.sleep_data = { bedtime: params[2] as string | null, wakeTime: params[3] as string | null, napDuration: params[4] as number | null, duration: null }
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('UPDATE daily_entries')) {
          const row = rows.find(item => item.userId === userId && item.date === params[1])
          if (row) row.habits = row.habits.filter(mark => mark.key !== params[2])
          return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }
        }
        throw new Error(`Unexpected query: ${sql}`)
      },
      release: () => undefined,
    }),
  } as unknown as FastifyInstance['pg'])
  await app.register(fastifyJwt, { secret: 'test-secret' })
  app.decorate('apiHandlers', createApiHandlers(app))
  await app.register(sleepRecordsRoutes, { prefix: '/sleep-records' })
  await app.register(statisticsRoutes, { prefix: '/statistics' })
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

test('daily habit marks reject unknown or foreign habits and preserve other marks', async (t) => {
  const { app, auth } = await makeApp([])
  t.after(() => app.close())
  const url = '/sleep-records/2026-10-02/habits/read'
  assert.equal((await app.inject({ method: 'PATCH', url: '/sleep-records/2026-10-02/habits/unknown', headers: auth('alice'), payload: { value: true } })).statusCode, 404)
  const headers = auth('alice')

  assert.equal((await app.inject({ method: 'PATCH', url, payload: { value: true } })).statusCode, 401)
  const first = await app.inject({ method: 'PATCH', url, headers, payload: { value: true } })
  assert.equal(first.statusCode, 200)
  assert.deepEqual(first.json(), { id: '2026-10-02', date: '2026-10-02', sleep: emptySleep, habits: [{ key: 'read', value: true }] })
  const changed = await app.inject({ method: 'PATCH', url, headers, payload: { value: false } })
  assert.equal(changed.statusCode, 200)
  assert.deepEqual(changed.json().habits, [{ key: 'read', value: false }])
  assert.equal((await app.inject({ method: 'GET', url: '/sleep-records/2026-10-02', headers })).json().habits[0].value, false)
  const missingDay = await app.inject({ method: 'DELETE', url, headers: auth('bob') })
  assert.equal(missingDay.statusCode, 404)
  assert.deepEqual(missingDay.json(), { message: 'Habit not found', code: 'NOT_FOUND' })
  const removed = await app.inject({ method: 'DELETE', url, headers })
  assert.equal(removed.statusCode, 200)
  assert.deepEqual(removed.json().habits, [])
  assert.equal((await app.inject({ method: 'DELETE', url, headers })).statusCode, 200)

  const invalidValue = await app.inject({ method: 'PATCH', url, headers, payload: { value: 'yes' } })
  assert.equal(invalidValue.statusCode, 400)
  assert.equal(invalidValue.json().code, 'BAD_REQUEST')
})

test('generated client can change and remove marks through the existing HTTP routes', async (t) => {
  const date = dayjs().tz('Europe/Moscow').format('YYYY-MM-DD')
  const missingDate = dayjs(date).add(1, 'day').format('YYYY-MM-DD')
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

  const created = await client.setDailyHabitMark(date, 'read', { value: true })
  assert.deepEqual(created.habits, [{ key: 'read', value: true }])
  assert.deepEqual((await client.getSleepRecords()).map((entry) => entry.date), [date])
  assert.deepEqual((await client.setDailyHabitMark(date, 'read', { value: false })).habits, [{ key: 'read', value: false }])
  assert.deepEqual((await client.removeDailyHabitMark(date, 'read')).habits, [])
  await assert.rejects(client.removeDailyHabitMark(missingDate, 'read'), (error) => {
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
    sleep: { bedtime: '2026-10-01 23:00', wakeTime: null, napDuration: 0, duration: null }, habits: [],
  })
  assert.deepEqual((await get('2026-10-01')).json(), first.json())

  const second = await put('2026-10-02', { wakeTime: '2026-10-02 07:00', napDuration: null })
  assert.equal(second.statusCode, 200)
  assert.deepEqual(second.json().sleep, { bedtime: null, wakeTime: '2026-10-02 07:00', napDuration: null, duration: 480 })
  assert.equal((await get('2026-10-02')).json().sleep.duration, 480)
  assert.equal((await app.inject({ method: 'GET', url: '/sleep-records/2026-10-02', headers: auth('bob') })).statusCode, 404)

  const invalid = await put('2026-10-03', {})
  assert.equal(invalid.statusCode, 400)
  assert.equal(invalid.json().code, 'BAD_REQUEST')
})

test('fixture sleep records can be read and edited while preserving the other time', async (t) => {
  const date = '2026-10-17'
  const fixtures = buildDevFixtures(date)
  const user = fixtures.users.find(({ email }) => email === 'daily@example.test')!
  const rows: Row[] = fixtures.entries
    .filter(({ user_id }) => user_id === user.id)
    .map(({ user_id, ...entry }) => ({ ...entry, userId: user_id }))
  const { app, auth } = await makeApp(rows)
  t.after(() => app.close())
  const headers = auth(user.id)
  const url = `/sleep-records/${date}`
  const original = await app.inject({ method: 'GET', url, headers })
  assert.equal(original.statusCode, 200)
  const { bedtime, wakeTime, napDuration } = original.json().sleep
  assert.equal(wakeTime, null)

  const wakeEdit = await app.inject({
    method: 'PUT', url, headers,
    payload: { bedtime, wakeTime: `${date} 07:00`, napDuration },
  })
  assert.equal(wakeEdit.statusCode, 200)
  assert.equal(wakeEdit.json().sleep.bedtime, bedtime)
  assert.equal(wakeEdit.json().sleep.wakeTime, `${date} 07:00`)

  const bedEdit = await app.inject({
    method: 'PUT', url, headers,
    payload: { bedtime: `${date} 22:30`, wakeTime: wakeEdit.json().sleep.wakeTime, napDuration },
  })
  assert.equal(bedEdit.statusCode, 200)
  const saved = await app.inject({ method: 'GET', url, headers })
  assert.equal(saved.json().sleep.bedtime, `${date} 22:30`)
  assert.equal(saved.json().sleep.wakeTime, `${date} 07:00`)
})

test('invalid sleep times return a bad request without changing stored records', async (t) => {
  const rows: Row[] = []
  const { app, auth } = await makeApp(rows)
  t.after(() => app.close())
  for (const field of ['bedtime', 'wakeTime']) {
    const response = await app.inject({
      method: 'PUT', url: '/sleep-records/2026-10-17', headers: auth('alice'),
      payload: { [field]: '2026-10-17T23:00:00+03:00', napDuration: null },
    })
    assert.equal(response.statusCode, 400)
    assert.equal(response.json().code, 'BAD_REQUEST')
    assert.match(response.json().message, new RegExp(`body/${field}`))
    assert.deepEqual(rows, [])
  }
})

test('unexpected sleep handler failures remain internal errors with private details hidden', async (t) => {
  const { app, auth } = await makeApp([])
  t.after(() => app.close())
  t.mock.method(app.apiHandlers, 'putSleepRecord', async () => {
    throw new Error('private database details')
  })
  const response = await app.inject({
    method: 'PUT', url: '/sleep-records/2026-10-17', headers: auth('alice'),
    payload: { wakeTime: '2026-10-17 07:00', napDuration: null },
  })
  assert.equal(response.statusCode, 500)
  assert.deepEqual(response.json(), { message: 'Internal Server Error', code: 'INTERNAL_ERROR' })
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

test('editing bedtime refreshes next month duration and preserves all habit marks', async (t) => {
  const { app, auth } = await makeApp([])
  t.after(() => app.close())
  const headers = auth('alice')
  const save = async (date: string, sleep: object) => {
    assert.equal((await app.inject({ method: 'PUT', url: `/sleep-records/${date}`, headers, payload: { napDuration: null, ...sleep } })).statusCode, 200)
  }
  await save('2026-09-30', { bedtime: '2026-09-30 23:00' })
  await save('2026-10-01', { wakeTime: '2026-10-01 07:00' })
  await app.inject({ method: 'PATCH', url: '/sleep-records/2026-09-30/habits/read', headers, payload: { value: false } })
  const stats = async () => (await app.inject({ url: '/statistics?granularity=month&from=2026-10-01&toExclusive=2026-11-01&asOfDate=2026-10-02', headers })).json()
  assert.equal((await stats()).columns[0].duration.value, 480)
  await save('2026-09-30', { bedtime: '2026-10-01 01:00' })
  assert.equal((await stats()).columns[0].duration.value, 360)
  assert.deepEqual((await app.inject({ url: '/sleep-records/2026-09-30', headers })).json().habits, [{ key: 'read', value: false }])
  await save('2026-09-30', { bedtime: null })
  assert.equal((await stats()).columns[0].duration.value, null)
})


test('a habit mark before its known creation date is rejected without creating a day', async (t) => {
  const rows: Row[] = []
  const { app, auth } = await makeApp(rows, [{ userId: 'alice', key: 'read', start_date: '2026-10-26' }])
  t.after(() => app.close())
  const response = await app.inject({ method: 'PATCH', url: '/sleep-records/2026-10-25/habits/read', headers: auth('alice'), payload: { value: true } })
  assert.equal(response.statusCode, 400)
  assert.deepEqual(rows, [])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { Client } from 'pg'
import { loadMigrations } from '../../src/db/migrate'
import {
  buildDevFixtures,
  devFixtureVersion,
  seedDevFixtures,
} from '../../src/db/dev-fixtures'

test('versioned fixtures reproduce linked profiles and known Moscow sleep records', () => {
  const fixtures = buildDevFixtures('2026-01-02')
  assert.deepEqual(buildDevFixtures('2026-01-02'), fixtures)
  assert.deepEqual(devFixtureVersion, { generator: '1', schema: '006' })
  assert.deepEqual(
    fixtures.users.map(({ email }) => email),
    ['empty@example.test', 'daily@example.test', 'history@example.test']
  )
  const [empty, daily, history] = fixtures.users
  assert.equal(fixtures.habits.filter(({ user_id }) => user_id === empty.id).length, 0)
  assert.equal(fixtures.entries.filter(({ user_id }) => user_id === empty.id).length, 0)
  const recent = fixtures.entries.filter(({ user_id }) => user_id === daily.id)
  assert.equal(recent.length, 31)
  assert.equal(recent[0].date, '2025-12-03')
  assert.equal(recent.at(-1)!.date, '2026-01-02')
  assert.deepEqual(recent[1].sleep_data, {
    bedtime: '2025-12-04T23:00:00+03:00',
    wakeTime: null,
    napDuration: null,
    duration: null,
  })
  assert.deepEqual(recent[4].sleep_data, {
    bedtime: '2025-12-07T23:00:00+03:00',
    wakeTime: '2025-12-07T07:00:00+03:00',
    napDuration: 30,
    duration: 510,
  })
  assert.deepEqual(recent[0].habits, [
    { key: 'walk', value: true },
    { key: 'reading', value: false },
  ])
  assert.deepEqual(recent[1].habits, [])
  assert.equal(recent[2].sleep_data.bedtime, null)
  assert.equal(recent[3].sleep_data.duration, null)
  const long = fixtures.entries.filter(({ user_id }) => user_id === history.id)
  assert.equal(long[0].date, '2024-01-03')
  assert.equal(long.at(-1)!.date, '2026-01-02')
  assert.ok(long.length > 600 && long.length < 731)
  assert.ok(!long.some(({ date }) => date === '2024-01-09'))
  for (const entry of fixtures.entries) {
    assert.equal(entry.id, `${entry.user_id}-${entry.date}`)
    for (const check of entry.habits) {
      assert.ok(
        fixtures.habits.some(
          (habit) => habit.user_id === entry.user_id && habit.key === check.key
        )
      )
    }
  }
})

test('fixture dates are explicit real calendar dates and independent of timezone or today', () => {
  for (const date of [
    '',
    '2026-02-30',
    '2025-02-29',
    '2026-1-02',
    'today',
    '2026-01-02T00:00:00Z',
    '0001-01-01',
  ]) {
    assert.throws(() => buildDevFixtures(date), /date/i)
  }
  const fixtures = buildDevFixtures('2024-02-29')
  assert.equal(fixtures.entries.at(-1)!.date, '2024-02-29')
  assert.equal(buildDevFixtures('9999-12-31').entries.at(-1)!.date, '9999-12-31')
})

test('invalid fixture passwords and dates fail before a connection is opened', async (t) => {
  const connect = t.mock.method(Client.prototype, 'connect', async () => {
    throw new Error('Unexpected connection')
  })
  const options = {
    connectionString: 'postgres://fixture:private@db.invalid/app',
    migrationsDir: '',
    date: '2026-01-02',
    password: 'valid-password',
  }
  for (const password of ['', 'short', 'x'.repeat(73), 'я'.repeat(37)]) {
    await assert.rejects(
      seedDevFixtures({ ...options, password }),
      /DEV_FIXTURE_PASSWORD/
    )
  }
  await assert.rejects(seedDevFixtures({ ...options, date: '2026-02-30' }), /date/)
  assert.equal(connect.mock.callCount(), 0)
})

test('seeding refuses incompatible history and existing application data before any insert', async (t) => {
  const migrationsDir = join(__dirname, '../../src/db/migrations')
  const journal = loadMigrations(migrationsDir).map(({ id, checksum }) => ({
    id,
    checksum,
  }))
  t.mock.method(Client.prototype, 'connect', async () => undefined)
  t.mock.method(Client.prototype, 'end', async () => undefined)
  let history = journal.slice(0, -1)
  let populated = false
  let inserts = 0
  t.mock.method(Client.prototype, 'query', async (sql: string) => {
    if (sql.startsWith('SELECT id, checksum')) return { rows: history }
    if (sql.includes('AS populated')) return { rows: [{ populated }] }
    if (sql.startsWith('INSERT')) inserts++
    return { rows: [] }
  })
  const options = {
    connectionString: 'postgres://fixture:private@db.invalid/app',
    migrationsDir,
    date: '2026-01-02',
    password: 'fixture-test-password',
  }
  await assert.rejects(seedDevFixtures(options), /schema 006/)
  history = journal.map((row, index) =>
    index === 0 ? { ...row, checksum: 'changed' } : row
  )
  await assert.rejects(seedDevFixtures(options), /schema 006/)
  history = journal
  populated = true
  await assert.rejects(seedDevFixtures(options), /empty application/)
  assert.equal(inserts, 0)
})

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import bcrypt from 'bcrypt'
import { Client } from 'pg'
import type { ApiSchemas } from '@sadhana/api-contract'
import { getPendingMigrations, loadMigrations } from './migrate'

export class FixtureError extends Error {}

export const devFixtureVersion = { generator: '1', schema: '006' } as const

type Fixtures = {
  users: { id: string; email: string }[]
  habits: { id: string; user_id: string; key: string; label: string }[]
  entries: {
    id: string
    user_id: string
    date: string
    sleep_data: ApiSchemas['SleepData']
    habits: ApiSchemas['HabitCheck'][]
  }[]
}

function calendarDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function validateFixtureDate(value: string): void {
  const date = new Date(`${value}T00:00:00Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    calendarDate(date) !== value ||
    value < '0003-01-01'
  ) {
    throw new FixtureError('Fixture date must be a real YYYY-MM-DD date from year 0003')
  }
}

function stableId(name: string): string {
  const hex = createHash('sha256').update(`sadhana-fixtures-1:${name}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function rangeStart(anchor: string, months: number): Date {
  const end = new Date(`${anchor}T00:00:00Z`)
  const day = end.getUTCDate()
  end.setUTCDate(1)
  end.setUTCMonth(end.getUTCMonth() - months + 1)
  end.setUTCDate(0)
  end.setUTCDate(Math.min(day, end.getUTCDate()) + 1)
  return end
}

export function buildDevFixtures(date: string): Fixtures {
  validateFixtureDate(date)
  const fixtures: Fixtures = { users: [], habits: [], entries: [] }
  for (const [profile, months] of [
    ['empty', 0],
    ['daily', 1],
    ['history', 24],
  ] as const) {
    const user = { id: stableId(profile), email: `${profile}@example.test` }
    fixtures.users.push(user)
    if (!months) continue
    for (const [key, label] of [
      ['walk', 'Прогулка'],
      ['reading', 'Чтение'],
    ]) {
      fixtures.habits.push({
        id: stableId(`${profile}:${key}`),
        user_id: user.id,
        key,
        label,
      })
    }
    let previous: Fixtures['entries'][number] | undefined
    const cursor = rangeStart(date, months)
    const end = new Date(`${date}T00:00:00Z`).getTime()
    for (
      let index = 0;
      cursor.getTime() <= end;
      index++, cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const current = calendarDate(cursor)
      // Keep the anchor itself, even if it would otherwise be a gap.
      if (profile === 'history' && index % 7 === 6 && current !== date) {
        previous = undefined
        continue
      }
      const bedtime = index % 7 === 2 ? null : `${current}T23:00:00+03:00`
      const wakeTime = index % 7 === 1 ? null : `${current}T07:00:00+03:00`
      const napDuration = index % 7 === 4 ? 30 : null
      const duration =
        previous?.sleep_data.bedtime && wakeTime ? 480 + (napDuration ?? 0) : null
      const entry: Fixtures['entries'][number] = {
        id: `${user.id}-${current}`,
        user_id: user.id,
        date: current,
        sleep_data: { bedtime, wakeTime, napDuration, duration },
        habits:
          index % 3 === 1
            ? []
            : [
                { key: 'walk', value: index % 3 === 0 },
                { key: 'reading', value: index % 3 !== 0 },
              ],
      }
      fixtures.entries.push(entry)
      previous = entry
    }
  }
  return fixtures
}

export function validateFixturePassword(
  password: string | undefined
): asserts password is string {
  if (!password?.trim() || password.length < 6 || Buffer.byteLength(password) > 72) {
    throw new FixtureError(
      'DEV_FIXTURE_PASSWORD must contain 6 or more characters and at most 72 bytes'
    )
  }
}

type FixtureOptions = { connectionString: string; migrationsDir: string; date: string }

async function checkSchema(client: Client, migrationsDir: string): Promise<void> {
  try {
    const migrations = loadMigrations(migrationsDir)
    const recorded = await client.query<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM schema_migrations ORDER BY id'
    )
    getPendingMigrations(migrations, recorded.rows)
    if (recorded.rows.at(-1)?.id !== devFixtureVersion.schema) throw new FixtureError()
  } catch {
    throw new FixtureError(
      'Fixtures require compatible schema 006 and an unchanged migration history'
    )
  }
}

async function checkRecords(client: Client, fixtures: Fixtures): Promise<void> {
  const users = await client.query('SELECT id, email FROM users ORDER BY id')
  const habits = await client.query(
    'SELECT id, user_id, key, label FROM habits ORDER BY id'
  )
  const entries = await client.query(
    'SELECT id, user_id, date, sleep_data, habits FROM daily_entries ORDER BY id'
  )
  const byId = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id, 'en'))
  if (
    !isDeepStrictEqual(byId(users.rows), byId(fixtures.users)) ||
    !isDeepStrictEqual(byId(habits.rows), byId(fixtures.habits)) ||
    !isDeepStrictEqual(byId(entries.rows), byId(fixtures.entries))
  ) {
    throw new FixtureError(
      'Stored fixture records differ from the expected initial state'
    )
  }
}

export async function seedDevFixtures(
  options: FixtureOptions & { password: string }
): Promise<void> {
  const fixtures = buildDevFixtures(options.date)
  validateFixturePassword(options.password)
  const client = new Client({
    connectionString: options.connectionString,
    connectionTimeoutMillis: 10_000,
  })
  try {
    await client.connect()
    await client.query('BEGIN')
    await client.query("SET LOCAL statement_timeout = '5min'")
    await client.query("SET LOCAL lock_timeout = '10s'")
    // Serialize seeds and block application writes until the empty check and all inserts commit.
    await client.query('LOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE')
    await checkSchema(client, options.migrationsDir)
    await client.query(
      'LOCK TABLE users, habits, daily_entries IN SHARE ROW EXCLUSIVE MODE'
    )
    const existing = await client.query<{ populated: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM users UNION ALL SELECT 1 FROM habits UNION ALL SELECT 1 FROM daily_entries) AS populated'
    )
    if (existing.rows[0].populated)
      throw new FixtureError(
        'Fixtures require empty application tables; existing work was preserved'
      )
    for (const user of fixtures.users) {
      const hash = await bcrypt.hash(options.password, 10)
      await client.query(
        'INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)',
        [user.id, user.email, hash]
      )
    }
    for (const habit of fixtures.habits) {
      await client.query(
        'INSERT INTO habits (id, user_id, key, label) VALUES ($1, $2, $3, $4)',
        [habit.id, habit.user_id, habit.key, habit.label]
      )
    }
    for (const entry of fixtures.entries) {
      await client.query(
        'INSERT INTO daily_entries (id, user_id, date, sleep_data, habits) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)',
        [
          entry.id,
          entry.user_id,
          entry.date,
          JSON.stringify(entry.sleep_data),
          JSON.stringify(entry.habits),
        ]
      )
    }
    await checkRecords(client, fixtures)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error instanceof FixtureError
      ? error
      : new FixtureError('Fixture transaction failed; no partial dataset was committed')
  } finally {
    await client.end().catch(() => undefined)
  }
}

// Public initial-state check for a compatible source later restored from Git.
export async function verifyDevFixtures(options: FixtureOptions): Promise<void> {
  const fixtures = buildDevFixtures(options.date)
  const client = new Client({
    connectionString: options.connectionString,
    connectionTimeoutMillis: 10_000,
  })
  try {
    await client.connect()
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query("SET LOCAL statement_timeout = '5min'")
    await checkSchema(client, options.migrationsDir)
    await checkRecords(client, fixtures)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error instanceof FixtureError
      ? error
      : new FixtureError('Fixture initial-state verification failed')
  } finally {
    await client.end().catch(() => undefined)
  }
}

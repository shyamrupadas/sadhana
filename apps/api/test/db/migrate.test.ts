import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { Client } from 'pg'
import { getMigrationStatus, loadMigrations, runMigrations } from '../../src/db/migrate'
import { loadMigrationTestConfiguration } from '../../src/db/dev-database'

const explicitRun = process.env.MIGRATION_DB_TEST === '1'
const sourceDir = join(__dirname, '..', '..', 'src', 'db', 'migrations')
const confirmation = 'reviewed-current-schema-and-sleep-data-001-006'

async function withDatabase(
  t: TestContext,
  action: (context: { client: Client; connectionString: string; migrationsDir: string; schema: string }) => Promise<void>,
  realChain = false,
): Promise<void> {
  if (!explicitRun) {
    t.skip('Run pnpm db:test --target <dev|test> for PostgreSQL scenarios')
    return
  }
  const target = process.env.MIGRATION_DB_TEST_TARGET
  if (target !== 'dev' && target !== 'test') throw new Error('Explicit database test target required')
  const testDatabaseUrl = loadMigrationTestConfiguration(target).MIGRATION_DATABASE_URL
  const schema = `migration_test_${randomUUID().replaceAll('-', '')}`
  const client = new Client({ connectionString: testDatabaseUrl })
  const migrationsDir = mkdtempSync(join(tmpdir(), 'sadhana-migrations-'))
  let connected = false
  let schemaCreated = false
  try {
    if (realChain) cpSync(sourceDir, migrationsDir, { recursive: true })
    else {
      writeFileSync(join(migrationsDir, '001_records.sql'), 'CREATE TABLE records (value int PRIMARY KEY); INSERT INTO records VALUES (1);')
      writeFileSync(join(migrationsDir, '002_increment.sql'), 'UPDATE records SET value = value + 1;')
    }
    await client.connect()
    connected = true
    await client.query(`CREATE SCHEMA "${schema}"`)
    schemaCreated = true
    const url = new URL(testDatabaseUrl)
    url.searchParams.set('options', `-csearch_path=${schema}`)
    await action({ client, connectionString: url.toString(), migrationsDir, schema })
  } finally {
    try {
      if (schemaCreated) await client.query(`DROP SCHEMA "${schema}" CASCADE`)
    } finally {
      try {
        if (connected) await client.end()
      } finally {
        rmSync(migrationsDir, { recursive: true, force: true })
      }
    }
  }
}

test('clean database applies the real chain once and preserves user data on repeat', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    await runMigrations({ connectionString, migrationsDir })
    const journal = await client.query<{ id: string; checksum: string; applied_at: Date; recorded_retrospectively: boolean }>(
      `SELECT id, checksum, applied_at, recorded_retrospectively FROM ${schema}.schema_migrations ORDER BY id`,
    )
    assert.deepEqual(journal.rows.map((row) => row.id), loadMigrations(migrationsDir).map(({ id }) => id))
    assert.ok(journal.rows.every((row) => row.checksum.trim().length === 64 && row.applied_at && !row.recorded_retrospectively))
    assert.equal(journal.rows[0].checksum.trim(), 'dd698c5d291d204b0296ff49a2b3ad1ddc730800f06be5377d77680eb364570b')

    const user = await client.query<{ id: string }>(
      `INSERT INTO ${schema}.users (email, password_hash) VALUES ('test@example.com', 'hash') RETURNING id`,
    )
    const userId = user.rows[0].id
    await client.query(`INSERT INTO ${schema}.habits (user_id, key, label) VALUES ($1, 'walk', 'Walk')`, [userId])
    await client.query(
      `INSERT INTO ${schema}.daily_entries (id, user_id, date, sleep_data) VALUES ($1, $2, '2026-10-04', '{"bedtime":null,"wakeTime":null,"napDuration":null,"duration":null}')`,
      [`${userId}-2026-10-04`, userId],
    )
    const before = []
    for (const table of ['users', 'habits', 'daily_entries']) {
      before.push((await client.query(`SELECT * FROM ${schema}.${table}`)).rows)
    }
    await runMigrations({ connectionString, migrationsDir })
    const after = []
    for (const table of ['users', 'habits', 'daily_entries']) {
      after.push((await client.query(`SELECT * FROM ${schema}.${table}`)).rows)
    }
    assert.deepEqual(after, before)
    const secondJournal = await client.query(`SELECT * FROM ${schema}.schema_migrations ORDER BY id`)
    assert.deepEqual(secondJournal.rows.map((row) => row.checksum), journal.rows.map((row) => row.checksum))
  }, true)
})

test('baseline records reviewed history without rerunning SQL or inventing application dates', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    await client.query(`SET search_path TO ${schema}`)
    for (const file of ['001_create_users_table.sql', '002_create_habits_and_daily_entries.sql', '003_fix_daily_entries_primary_key.sql', '004_fix_daily_entries_id_length.sql', '005_migrate_bedtime_to_previous_day.sql', '006_set_duration_min_null_for_missing_times.sql']) {
      await client.query(readFileSync(join(migrationsDir, file), 'utf8'))
    }
    const user = await client.query<{ id: string }>(
      "INSERT INTO users (email, password_hash) VALUES ('old@example.com', 'hash') RETURNING id",
    )
    await client.query(
      "INSERT INTO daily_entries (id, user_id, date) VALUES ($1, $2, '2026-10-04')",
      [`${user.rows[0].id}-2026-10-04`, user.rows[0].id],
    )
    const before = await client.query('SELECT * FROM users')
    await assert.rejects(runMigrations({ connectionString, migrationsDir }), /no migration journal/)
    await assert.rejects(
      runMigrations({ connectionString, migrationsDir, mode: 'baseline-confirmed-001-006' }),
      /explicit confirmation/,
    )
    await client.query('ALTER TABLE daily_entries ALTER COLUMN id TYPE VARCHAR(100)')
    await assert.rejects(
      runMigrations({ connectionString, migrationsDir, mode: 'baseline-confirmed-001-006', confirmation }),
      /does not match confirmed migrations/,
    )
    await client.query('ALTER TABLE daily_entries ALTER COLUMN id TYPE VARCHAR(255)')
    await client.query("UPDATE daily_entries SET sleep_data = '{}'::jsonb")
    await assert.rejects(
      runMigrations({ connectionString, migrationsDir, mode: 'baseline-confirmed-001-006', confirmation }),
      /migration 006 is not confirmed/,
    )
    await client.query('UPDATE daily_entries SET sleep_data = DEFAULT')
    await runMigrations({ connectionString, migrationsDir, mode: 'baseline-confirmed-001-006', confirmation })
    const journal = await client.query('SELECT id, applied_at, recorded_retrospectively FROM schema_migrations ORDER BY id')
    assert.deepEqual(journal.rows.map((row) => row.id), ['001', '002', '003', '004', '005', '006'])
    assert.ok(journal.rows.every((row) => row.applied_at === null && row.recorded_retrospectively))
    await runMigrations({ connectionString, migrationsDir })
    assert.deepEqual((await client.query('SELECT * FROM users')).rows, before.rows)
    await assert.rejects(runMigrations({ connectionString, migrationsDir, mode: 'baseline-confirmed-001-006', confirmation }), /empty migration journal/)
  }, true)
})

test('baseline requires operator confirmation when history cannot be inferred from schema', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    await client.query(`SET search_path TO ${schema}`)
    for (const file of ['001_create_users_table.sql', '002_create_habits_and_daily_entries.sql', '003_fix_daily_entries_primary_key.sql', '004_fix_daily_entries_id_length.sql']) {
      await client.query(readFileSync(join(migrationsDir, file), 'utf8'))
    }
    const user = await client.query<{ id: string }>(
      "INSERT INTO users (email, password_hash) VALUES ('partial@example.com', 'hash') RETURNING id",
    )
    await client.query(
      `INSERT INTO daily_entries (id, user_id, date, sleep_data) VALUES ($1, $2, '2026-10-04', '{"bedtime":"2026-10-04T23:00:00","wakeTime":"2026-10-05T07:00:00","napDurationMin":0,"durationMin":480}')`,
      [`${user.rows[0].id}-2026-10-04`, user.rows[0].id],
    )
    await client.query(readFileSync(join(migrationsDir, '006_set_duration_min_null_for_missing_times.sql'), 'utf8'))
    await assert.rejects(
      runMigrations({ connectionString, migrationsDir, mode: 'baseline-confirmed-001-006' }),
      /explicit confirmation/,
    )
    assert.equal((await client.query("SELECT to_regclass('schema_migrations') AS name")).rows[0].name, null)
  }, true)
})


test('status is read-only for empty, applied and invalid histories', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    const readOnly = new URL(connectionString)
    readOnly.searchParams.set('options', `-csearch_path=${schema} -cdefault_transaction_read_only=on`)
    const status = () => getMigrationStatus({ connectionString: readOnly.toString(), migrationsDir })
    assert.deepEqual(await status(), { journalExists: false, applied: [], pending: ['001', '002'] })
    assert.equal((await client.query('SELECT to_regclass($1) AS name', [`${schema}.schema_migrations`])).rows[0].name, null)
    await client.query(`CREATE TABLE ${schema}.untracked (id int)`)
    await assert.rejects(status(), /no migration journal/)
    await client.query(`DROP TABLE ${schema}.untracked`)
    await runMigrations({ connectionString, migrationsDir, to: '001' })
    const before = await client.query(`SELECT * FROM ${schema}.schema_migrations ORDER BY id`)
    assert.deepEqual(await status(), { journalExists: true, applied: ['001'], pending: ['002'] })
    assert.deepEqual((await client.query(`SELECT * FROM ${schema}.schema_migrations ORDER BY id`)).rows, before.rows)
    writeFileSync(join(migrationsDir, '001_records.sql'), 'SELECT 1;')
    await assert.rejects(status(), /checksum changed/)
  })
})

test('prefix application preserves data and the complete journal on repeat and continues forward', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    const options = { connectionString, migrationsDir }
    await runMigrations({ ...options, to: '001' })
    assert.deepEqual((await client.query(`SELECT * FROM ${schema}.records`)).rows, [{ value: 1 }])
    const before = (await client.query(`SELECT * FROM ${schema}.schema_migrations ORDER BY id`)).rows
    await runMigrations({ ...options, to: '001' })
    assert.deepEqual((await client.query(`SELECT * FROM ${schema}.schema_migrations ORDER BY id`)).rows, before)
    await assert.rejects(runMigrations({ ...options, to: '003' }), /must exist/)
    await runMigrations(options)
    assert.deepEqual((await client.query(`SELECT * FROM ${schema}.records`)).rows, [{ value: 2 }])
    await assert.rejects(runMigrations({ ...options, to: '001' }), /below the applied/)
    const journal = (await client.query(`SELECT * FROM ${schema}.schema_migrations ORDER BY id`)).rows
    assert.deepEqual(journal.map(({ id }) => id), ['001', '002'])
    assert.equal(journal[0].checksum.trim(), '7b48fc03db13465d89d01feb5a682c0f1031958700800b0021618155db1ec888')
    assert.ok(journal.every(({ applied_at, recorded_retrospectively }) => applied_at && !recorded_retrospectively))
    await runMigrations(options)
    assert.deepEqual((await client.query(`SELECT * FROM ${schema}.records`)).rows, [{ value: 2 }])
    assert.deepEqual((await client.query(`SELECT * FROM ${schema}.schema_migrations ORDER BY id`)).rows, journal)
  })
})

test('changed SQL, unknown versions and journal gaps stop status and application', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    const options = { connectionString, migrationsDir }
    await runMigrations(options)
    const first = join(migrationsDir, '001_records.sql')
    const original = readFileSync(first)
    writeFileSync(first, 'SELECT 1;')
    for (const read of [getMigrationStatus, runMigrations]) await assert.rejects(read(options), /checksum changed/)
    writeFileSync(first, original)
    await client.query(`INSERT INTO ${schema}.schema_migrations (id, checksum) VALUES ('999', repeat('a', 64))`)
    for (const read of [getMigrationStatus, runMigrations]) await assert.rejects(read(options), /Unknown or out-of-sequence/)
    await client.query(`DELETE FROM ${schema}.schema_migrations WHERE id IN ('001', '999')`)
    for (const read of [getMigrationStatus, runMigrations]) await assert.rejects(read(options), /Unknown or out-of-sequence/)
    rmSync(join(migrationsDir, '001_records.sql'))
    await assert.rejects(runMigrations(options), /unique sequence/)
  })
})

test('failed SQL rolls back its effects and journal while keeping the preceding success', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    writeFileSync(join(migrationsDir, '002_increment.sql'),
      'UPDATE records SET value = 99; CREATE TABLE failed_probe (id int); SELECT * FROM missing_table;')
    await assert.rejects(runMigrations({ connectionString, migrationsDir }))
    assert.deepEqual((await client.query(`SELECT * FROM ${schema}.records`)).rows, [{ value: 1 }])
    assert.equal((await client.query('SELECT to_regclass($1) AS name', [`${schema}.failed_probe`])).rows[0].name, null)
    assert.deepEqual((await client.query(`SELECT id FROM ${schema}.schema_migrations ORDER BY id`)).rows, [{ id: '001' }])
  })
})

test('parallel runs serialize and apply each SQL only once', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    await Promise.all([runMigrations({ connectionString, migrationsDir }), runMigrations({ connectionString, migrationsDir })])
    assert.deepEqual((await client.query(`SELECT * FROM ${schema}.records`)).rows, [{ value: 2 }])
    assert.deepEqual((await client.query(`SELECT id FROM ${schema}.schema_migrations ORDER BY id`)).rows, [{ id: '001' }, { id: '002' }])
  })
})

test('real sleep migrations preserve marks and transform stored legacy sleep fields', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    await runMigrations({ connectionString, migrationsDir, to: '004' })
    const user = await client.query<{ id: string }>(
      `INSERT INTO ${schema}.users (email, password_hash) VALUES ('sleep@example.test', 'hash') RETURNING id`,
    )
    const userId = user.rows[0].id
    await client.query(`INSERT INTO ${schema}.daily_entries (id, user_id, date, sleep_data, habits)
      VALUES ($1, $2, '2026-01-02', $3, $4)`, [
      `${userId}-2026-01-02`, userId,
      { bedtime: '2026-01-01T23:00:00', wakeTime: '2026-01-02T07:00:00', napDurationMin: 30, durationMin: 0 },
      JSON.stringify([{ key: 'walk', completed: true }]),
    ])
    await runMigrations({ connectionString, migrationsDir, to: '006' })
    const rows = await client.query(`SELECT date, sleep_data, habits FROM ${schema}.daily_entries ORDER BY date`)
    assert.deepEqual(rows.rows, [
      { date: '2026-01-01', sleep_data: { bedtime: '2026-01-01T23:00:00', wakeTime: null,
        napDuration: null, duration: null }, habits: [{ key: 'walk', completed: true }] },
      { date: '2026-01-02', sleep_data: { bedtime: '2026-01-01T23:00:00', wakeTime: '2026-01-02T07:00:00',
        napDuration: 30, duration: 510 }, habits: [{ key: 'walk', completed: true }] },
    ])
  }, true)
})

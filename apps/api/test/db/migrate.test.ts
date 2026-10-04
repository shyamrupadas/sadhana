import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { Client } from 'pg'
import { runMigrations } from '../../src/db/migrate'

const testDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL
const sourceDir = join(__dirname, '..', '..', 'src', 'db', 'migrations')
const confirmation = 'reviewed-current-schema-and-sleep-data-001-006'

async function withDatabase(
  t: TestContext,
  action: (context: { client: Client; connectionString: string; migrationsDir: string; schema: string }) => Promise<void>,
): Promise<void> {
  if (!testDatabaseUrl) {
    t.skip('Set MIGRATION_TEST_DATABASE_URL to an isolated PostgreSQL database')
    return
  }

  const schema = `migration_test_${randomUUID().replaceAll('-', '')}`
  const client = new Client({ connectionString: testDatabaseUrl })
  const migrationsDir = mkdtempSync(join(tmpdir(), 'sadhana-migrations-'))
  let connected = false
  let schemaCreated = false
  try {
    cpSync(sourceDir, migrationsDir, { recursive: true })
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

test('clean database applies 001–006 once and preserves user data on repeat', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    await runMigrations({ connectionString, migrationsDir })
    const journal = await client.query<{ id: string; checksum: string; applied_at: Date; recorded_retrospectively: boolean }>(
      `SELECT id, checksum, applied_at, recorded_retrospectively FROM ${schema}.schema_migrations ORDER BY id`,
    )
    assert.deepEqual(journal.rows.map((row) => row.id), ['001', '002', '003', '004', '005', '006'])
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
  })
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
  })
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
  })
})

test('changed SQL, unknown versions and journal gaps stop migration', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    await runMigrations({ connectionString, migrationsDir })
    const first = join(migrationsDir, '001_create_users_table.sql')
    const original = readFileSync(first)
    writeFileSync(first, Buffer.concat([original, Buffer.from('\n-- changed\n')]))
    await assert.rejects(runMigrations({ connectionString, migrationsDir }), /checksum changed/)
    writeFileSync(first, original)

    await client.query(`INSERT INTO ${schema}.schema_migrations (id, checksum) VALUES ('007', repeat('a', 64))`)
    await assert.rejects(runMigrations({ connectionString, migrationsDir }), /Unknown or out-of-sequence/)
    await client.query(`DELETE FROM ${schema}.schema_migrations WHERE id = '007'`)
    await client.query(`DELETE FROM ${schema}.schema_migrations WHERE id = '003'`)
    await assert.rejects(runMigrations({ connectionString, migrationsDir }), /Unknown or out-of-sequence/)
    const cli = spawnSync(process.execPath, [join(__dirname, '..', '..', 'dist', 'db', 'migrate.js')], {
      cwd: join(__dirname, '..', '..'),
      env: { ...process.env, NODE_ENV: 'production', MIGRATION_DATABASE_URL: connectionString },
      encoding: 'utf8',
    })
    assert.equal(cli.status, 1)
    assert.match(cli.stderr, /Unknown or out-of-sequence/)
    rmSync(join(migrationsDir, '002_create_habits_and_daily_entries.sql'))
    await assert.rejects(runMigrations({ connectionString, migrationsDir }), /unique sequence/)
  })
})

test('failed SQL rolls back its effects and journal entry', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    await runMigrations({ connectionString, migrationsDir })
    writeFileSync(join(migrationsDir, '007_failure.sql'), 'CREATE TABLE failed_migration_probe (id int); SELECT * FROM missing_table;')
    await assert.rejects(runMigrations({ connectionString, migrationsDir }))
    const probe = await client.query('SELECT to_regclass($1) AS name', [`${schema}.failed_migration_probe`])
    assert.equal(probe.rows[0].name, null)
    const count = await client.query(`SELECT count(*)::int AS count FROM ${schema}.schema_migrations`)
    assert.equal(count.rows[0].count, 6)
  })
})

test('parallel runs serialize and apply each SQL only once', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    await Promise.all([
      runMigrations({ connectionString, migrationsDir }),
      runMigrations({ connectionString, migrationsDir }),
    ])
    const count = await client.query(`SELECT count(*)::int AS count FROM ${schema}.schema_migrations`)
    assert.equal(count.rows[0].count, 6)
  })
})

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
    await client.query(`INSERT INTO ${schema}.habits (user_id, label, start_date) VALUES ($1, 'Walk', '2026-10-04')`, [userId])
    await client.query(
      `INSERT INTO ${schema}.daily_entries (id, user_id, date) VALUES ($1, $2, '2026-10-04')`,
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

test('index cleanup preserves records and enforces day and email uniqueness', async (t) => {
  await withDatabase(
    t,
    async ({ client, connectionString, migrationsDir, schema }) => {
      await client.query(`SET search_path TO "${schema}"`)
      const options = { connectionString, migrationsDir }
      await runMigrations({ ...options, to: '006' })
      const users = (
        await client.query(
          "INSERT INTO users (email, password_hash) VALUES ('first@example.test', 'hash-one'), ('second@example.test', 'hash-two') RETURNING id"
        )
      ).rows
      await client.query(
        "INSERT INTO habits (user_id, key, label) VALUES ($1, 'read', 'Чтение')",
        [users[0].id]
      )
      await client.query(
        `INSERT INTO daily_entries (id, user_id, date, sleep_data, habits)
       VALUES ('original', $1, '2026-01-02', '{"bedtime":null,"wakeTime":"2026-01-02 07:00","napDuration":30,"duration":510}', '[{"key":"read","value":false}]')`,
        [users[0].id]
      )
      const records = async () => {
        const rows = []
        for (const table of ['users', 'habits', 'daily_entries']) {
          rows.push((await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows)
        }
        return rows
      }
      const indexes = async () =>
        (
          await client.query(
            'SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname',
            [schema]
          )
        ).rows
      const constraints = async () =>
        (
          await client.query(
            `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE connamespace = $1::regnamespace ORDER BY conname`,
            [schema]
          )
        ).rows
      const before = await records()
      const oldIndexes = await indexes()
      const oldConstraints = await constraints()
      await runMigrations({ ...options, to: '007' })
      assert.deepEqual(await records(), before)
      assert.deepEqual(
        await indexes(),
        oldIndexes.filter(
          ({ indexname }) =>
            ![
              'idx_daily_entries_user_date',
              'daily_entries_user_id_date_key',
              'idx_users_email',
            ].includes(indexname)
        )
      )
      assert.deepEqual(
        await constraints(),
        oldConstraints.filter(
          ({ conname }) => conname !== 'daily_entries_user_id_date_key'
        )
      )
      assert.equal((await getMigrationStatus(options)).applied.at(-1), '007')
      const journal = (await client.query('SELECT * FROM schema_migrations ORDER BY id'))
        .rows
      await runMigrations({ ...options, to: '007' })
      assert.deepEqual(await records(), before)
      assert.deepEqual(
        (await client.query('SELECT * FROM schema_migrations ORDER BY id')).rows,
        journal
      )
      await assert.rejects(
        client.query(
          "INSERT INTO users (email, password_hash) VALUES ('first@example.test', 'other')"
        ),
        { code: '23505' }
      )
      await assert.rejects(
        client.query(
          "INSERT INTO daily_entries (id, user_id, date) VALUES ('duplicate', $1, '2026-01-02')",
          [users[0].id]
        ),
        { code: '23505' }
      )
      await client.query(
        "INSERT INTO daily_entries (id, user_id, date) VALUES ('other-user', $1, '2026-01-02')",
        [users[1].id]
      )
      await client.query(
        'UPDATE daily_entries SET habits = \'[{"key":"read","value":true}]\' WHERE id = \'original\''
      )
      assert.deepEqual(
        (await client.query("SELECT habits FROM daily_entries WHERE id = 'original'"))
          .rows,
        [{ habits: [{ key: 'read', value: true }] }]
      )
    },
    true
  )
})

test('index cleanup refuses changed definitions and dependencies without partial changes', async (t) => {
  for (const setup of [
    'DROP INDEX idx_users_email; CREATE INDEX idx_users_email ON users (lower(email))',
    'CREATE TABLE dependent (user_id uuid, date varchar(10), FOREIGN KEY (user_id, date) REFERENCES daily_entries (user_id, date))',
  ]) {
    await withDatabase(
      t,
      async ({ client, connectionString, migrationsDir, schema }) => {
        await client.query(`SET search_path TO "${schema}"`)
        const options = { connectionString, migrationsDir }
        await runMigrations({ ...options, to: '006' })
        await client.query(setup)
        const structure = async () =>
          (
            await client.query(
              'SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname',
              [schema]
            )
          ).rows
        const before = await structure()
        const journal = (
          await client.query('SELECT * FROM schema_migrations ORDER BY id')
        ).rows
        await assert.rejects(runMigrations(options))
        assert.deepEqual(await structure(), before)
        assert.deepEqual(
          (await client.query('SELECT * FROM schema_migrations ORDER BY id')).rows,
          journal
        )
      },
      true
    )
  }
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

test('typed sleep migration preserves local facts and habits, rejects invalid source and repeats unchanged', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    await client.query(`SET search_path TO "${schema}"`)
    await runMigrations({ connectionString, migrationsDir, to: '007' })
    const owner = (await client.query("INSERT INTO users (email, password_hash) VALUES ('typed@example.test', 'hash') RETURNING id")).rows[0].id
    const facts = { bedtime: '2026-10-05T01:15:00', wakeTime: '2026-10-04 08:30', napDuration: 30, duration: 999 }
    await client.query(`INSERT INTO daily_entries (id, user_id, date, sleep_data, habits) VALUES ('source', $1, '2026-10-04', $2, '[{"key":"read","value":false}]')`, [owner, facts])
    await client.query(`UPDATE daily_entries SET sleep_data = jsonb_set(sleep_data, '{wakeTime}', '"2026-02-30 08:30"')`)
    await assert.rejects(runMigrations({ connectionString, migrationsDir, to: '008' }))
    assert.equal((await client.query("SELECT sleep_data->>'wakeTime' AS value FROM daily_entries")).rows[0].value, '2026-02-30 08:30')
    assert.equal((await client.query("SELECT to_regclass('sleep_records') AS name")).rows[0].name, null)
    await client.query('UPDATE daily_entries SET sleep_data = $1', [facts])
    const transfer = join(migrationsDir, '008_type_sleep_records.sql')
    const checkedSql = readFileSync(transfer, 'utf8')
    // Fault injection after copying: a value mismatch must abort before dropping the source.
    writeFileSync(transfer, checkedSql.replace('DO $$\nBEGIN\n  IF (SELECT count(*)', 'UPDATE sleep_records SET nap_minutes = 99;\nDO $$\nBEGIN\n  IF (SELECT count(*)'))
    await assert.rejects(runMigrations({ connectionString, migrationsDir, to: '008' }))
    assert.deepEqual((await client.query('SELECT sleep_data FROM daily_entries')).rows[0].sleep_data, facts)
    assert.equal((await client.query("SELECT to_regclass('sleep_records') AS name")).rows[0].name, null)
    writeFileSync(transfer, checkedSql)
    await runMigrations({ connectionString, migrationsDir, to: '008' })
    const read = async () => ({
      sleep: (await client.query("SELECT user_id, date::text, to_char(bedtime, 'YYYY-MM-DD HH24:MI') AS bedtime, to_char(wake_time, 'YYYY-MM-DD HH24:MI') AS wake_time, nap_minutes FROM sleep_records")).rows,
      days: (await client.query('SELECT * FROM daily_entries')).rows,
      journal: (await client.query('SELECT * FROM schema_migrations ORDER BY id')).rows,
    })
    const before = await read()
    assert.deepEqual(before.sleep, [{ user_id: owner, date: '2026-10-04', bedtime: '2026-10-05 01:15', wake_time: '2026-10-04 08:30', nap_minutes: 30 }])
    assert.deepEqual(before.days[0].habits, [{ key: 'read', value: false }])
    assert.equal('sleep_data' in before.days[0], false)
    await runMigrations({ connectionString, migrationsDir, to: '008' })
    assert.deepEqual(await read(), before)
    await assert.rejects(client.query("INSERT INTO sleep_records (user_id, date, nap_minutes) VALUES ($1, '2026-10-04', 0)", [owner]), { code: '23505' })
    await assert.rejects(client.query("UPDATE sleep_records SET nap_minutes = -1"), { code: '23514' })
  }, true)
})

test('habit migration reconciles UUIDs, false marks, mixed history and only counted orphans', async (t) => {
  await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
    await client.query(`SET search_path TO "${schema}"`)
    const options = { connectionString, migrationsDir }
    await runMigrations({ ...options, to: '008' })
    const owners = (await client.query("INSERT INTO users (email, password_hash) VALUES ('habits@example.test', 'hash'), ('other@example.test', 'hash') RETURNING id")).rows
    const owner = owners[0].id
    const habit = (await client.query("INSERT INTO habits (user_id, key, label, created_at) VALUES ($1, 'read', 'Книги', '2026-10-04 00:30') RETURNING id", [owner])).rows[0].id
    await client.query("INSERT INTO habits (user_id, key, label, created_at) VALUES ($1, 'unknown', 'Неизвестная', NULL), ($1, 'dated', 'Только создание', '2026-09-30 23:30')", [owner])
    await client.query("INSERT INTO habits (user_id, key, label) VALUES ($1, 'other-only', 'Чужая')", [owners[1].id])
    await client.query(`INSERT INTO daily_entries (id, user_id, date, habits) VALUES
      ('early', $1, '2020-01-02', '[{"key":"read","value":false},{"key":"orphan","value":true},{"key":"other-only","value":false}]'),
      ('later', $1, '2026-10-04', '[{"key":"read","value":true}]')`, [owner])
    await client.query("INSERT INTO sleep_records (user_id, date, wake_time, nap_minutes) VALUES ($1, '2026-10-04', '2026-10-04 07:15', 25)", [owner])
    const sleep = (await client.query('SELECT * FROM sleep_records')).rows
    const journal = (await client.query('SELECT * FROM schema_migrations ORDER BY id')).rows
    await runMigrations({ ...options, to: '009' })
    assert.deepEqual((await client.query('SELECT habit_id, date::text, value FROM habit_marks ORDER BY date')).rows, [
      { habit_id: habit, date: '2020-01-02', value: false }, { habit_id: habit, date: '2026-10-04', value: true },
    ])
    assert.deepEqual((await client.query("SELECT id, start_date::text, archived, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS original FROM habits WHERE id = $1", [habit])).rows, [
      { id: habit, start_date: '2020-01-02', archived: false, original: '2026-10-04 00:30' },
    ])
    assert.equal((await client.query("SELECT start_date FROM habits WHERE label = 'Неизвестная'")).rows[0].start_date, null)
    assert.equal((await client.query("SELECT start_date::text FROM habits WHERE label = 'Только создание'")).rows[0].start_date, '2026-09-30')
    assert.deepEqual((await client.query('SELECT * FROM sleep_records')).rows, sleep)
    assert.equal((await client.query('SELECT count(*)::int AS n FROM daily_entries')).rows[0].n, 2)
    assert.equal((await client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = $1 AND ((table_name = 'daily_entries' AND column_name = 'habits') OR (table_name = 'habits' AND column_name = 'key'))", [schema])).rows[0].n, 0)
    assert.deepEqual((await client.query("SELECT * FROM schema_migrations WHERE id < '009' ORDER BY id")).rows, journal)
    const snapshot = async () => Promise.all(['habits', 'habit_marks', 'sleep_records', 'daily_entries', 'schema_migrations'].map(async table => (await client.query(`SELECT * FROM ${table} ORDER BY 1, 2`)).rows))
    const before = await snapshot()
    await runMigrations(options)
    assert.deepEqual(await snapshot(), before)
    await assert.rejects(client.query("INSERT INTO habit_marks (user_id, date, habit_id, value) VALUES ($1, '2020-01-02', $2, true)", [owner, habit]), { code: '23505' })
    await assert.rejects(client.query("INSERT INTO habit_marks (user_id, date, habit_id, value) VALUES ($1, '2020-01-03', $2, true)", [owners[1].id, habit]), { code: '23503' })
  }, true)
})

test('habit migration rejects malformed marks, collisions and injected mismatches before source cleanup', async (t) => {
  for (const marks of ['[{"key":"read","value":"false"}]', '[{"key":"read","value":true},{"key":"read","value":false}]', '[{"key":"read","value":false}]']) {
    await withDatabase(t, async ({ client, connectionString, migrationsDir, schema }) => {
      await client.query(`SET search_path TO "${schema}"`)
      const options = { connectionString, migrationsDir }
      await runMigrations({ ...options, to: '008' })
      const owner = (await client.query("INSERT INTO users (email, password_hash) VALUES ('bad@example.test', 'hash') RETURNING id")).rows[0].id
      await client.query("INSERT INTO habits (user_id, key, label) VALUES ($1, 'read', 'Read')", [owner])
      await client.query("INSERT INTO daily_entries (id, user_id, date, habits) VALUES ('bad', $1, '2026-10-04', $2)", [owner, marks])
      if (marks === '[{"key":"read","value":false}]') {
        const file = join(migrationsDir, '009_normalize_habit_marks.sql')
        writeFileSync(file, readFileSync(file, 'utf8').replace('-- Reconcile before cleanup.', 'UPDATE habit_marks SET value = NOT value;\n-- Reconcile before cleanup.'))
      }
      const before = (await client.query('SELECT * FROM daily_entries')).rows
      await assert.rejects(runMigrations(options))
      assert.deepEqual((await client.query('SELECT * FROM daily_entries')).rows, before)
      assert.equal((await client.query("SELECT to_regclass('habit_marks') AS name")).rows[0].name, null)
      assert.equal((await client.query('SELECT max(id) AS id FROM schema_migrations')).rows[0].id, '008')
    }, true)
  }
})

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { config } from 'dotenv'
import { Client } from 'pg'

type Migration = { id: string; file: string; sql: string; checksum: string }
type Mode = 'apply' | 'baseline-confirmed-001-006'

const advisoryLockKey = 734821607
const historicalIds = ['001', '002', '003', '004', '005', '006']
const baselineConfirmation = 'reviewed-current-schema-and-sleep-data-001-006'

function loadMigrations(dir: string): Migration[] {
  const files = readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()
  if (files.length === 0) throw new Error('No SQL migrations found')

  return files.map((file, index) => {
    const match = /^(\d{3})_[^/]+\.sql$/.exec(file)
    const id = match?.[1]
    if (!id || Number(id) !== index + 1) {
      throw new Error(`Migration filenames must form a unique sequence from 001: ${file}`)
    }
    const bytes = readFileSync(join(dir, file))
    return {
      id,
      file,
      sql: bytes.toString('utf8'),
      checksum: createHash('sha256').update(bytes).digest('hex'),
    }
  })
}

function validateDirectUrl(connectionString: string): void {
  const url = new URL(connectionString)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('MIGRATION_DATABASE_URL must be a PostgreSQL URL')
  }
  if (url.hostname.includes('-pooler') || url.port === '6432') {
    throw new Error('Migrations require a direct PostgreSQL connection, not a pooler')
  }
}

async function inTransaction(client: Client, action: () => Promise<void>): Promise<void> {
  await client.query('BEGIN')
  try {
    await client.query("SET LOCAL statement_timeout = '5min'")
    await client.query("SET LOCAL lock_timeout = '10s'")
    await action()
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

export async function runMigrations(options: {
  connectionString: string
  migrationsDir: string
  mode?: Mode
  confirmation?: string
}): Promise<void> {
  const { connectionString, migrationsDir, mode = 'apply', confirmation } = options
  if (mode === 'baseline-confirmed-001-006' && confirmation !== baselineConfirmation) {
    throw new Error('Baseline requires explicit confirmation of the current schema and sleep data for 001–006')
  }
  validateDirectUrl(connectionString)
  const migrations = loadMigrations(migrationsDir)
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 })
  let connected = false

  try {
    await client.connect()
    connected = true
    await client.query("SET statement_timeout = '30s'")
    await client.query('SELECT pg_advisory_lock($1)', [advisoryLockKey])

    const journalExists = await client.query<{ exists: string | null }>(
      "SELECT to_regclass('schema_migrations')::text AS exists",
    )
    if (!journalExists.rows[0].exists && mode === 'apply') {
      const existingTables = await client.query<{ exists: string | null }>(
        "SELECT to_regclass('users')::text AS exists",
      )
      if (existingTables.rows[0].exists) {
        throw new Error('Existing database has no migration journal; review it and run the baseline operation')
      }
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(3) PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        applied_at TIMESTAMPTZ,
        recorded_retrospectively BOOLEAN NOT NULL DEFAULT FALSE
      )
    `)
    const recorded = await client.query<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM schema_migrations ORDER BY id',
    )

    for (const [index, row] of recorded.rows.entries()) {
      const migration = migrations[index]
      if (!migration || row.id !== migration.id) {
        throw new Error(`Unknown or out-of-sequence migration in journal: ${row.id}`)
      }
      if (row.checksum.trim() !== migration.checksum) {
        throw new Error(`Migration checksum changed: ${row.id}`)
      }
    }

    if (mode === 'baseline-confirmed-001-006') {
      if (recorded.rows.length !== 0) throw new Error('Baseline requires an empty migration journal')
      if (historicalIds.some((id, index) => migrations[index]?.id !== id)) {
        throw new Error('Baseline requires the original migrations 001–006')
      }
      const tables = await client.query<{ users: string | null; habits: string | null; entries: string | null }>(
        "SELECT to_regclass('users')::text AS users, to_regclass('habits')::text AS habits, to_regclass('daily_entries')::text AS entries",
      )
      if (!tables.rows[0].users || !tables.rows[0].habits || !tables.rows[0].entries) {
        throw new Error('Baseline requires an existing, reviewed database schema')
      }
      const shape = await client.query<{ id_length: number | null; sleep_default: string | null; primary_key: string | null }>(`
        SELECT
          (SELECT character_maximum_length FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'daily_entries' AND column_name = 'id') AS id_length,
          (SELECT column_default FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'daily_entries' AND column_name = 'sleep_data') AS sleep_default,
          (SELECT string_agg(attribute.attname::text, ',' ORDER BY key.ordinality)
           FROM pg_constraint constraint_row
           JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS key(number, ordinality) ON TRUE
           JOIN pg_attribute attribute ON attribute.attrelid = constraint_row.conrelid AND attribute.attnum = key.number
           WHERE constraint_row.conrelid = 'daily_entries'::regclass AND constraint_row.contype = 'p') AS primary_key
      `)
      const { id_length, sleep_default, primary_key } = shape.rows[0]
      if (id_length !== 255 || !sleep_default?.includes('napDuration') || !sleep_default.includes('duration') ||
          primary_key !== 'user_id,date') {
        throw new Error('Database schema does not match confirmed migrations 001–006')
      }
      const legacyData = await client.query<{ count: string }>(`
        SELECT count(*) AS count FROM daily_entries
        WHERE sleep_data ? 'napDurationMin' OR sleep_data ? 'durationMin'
           OR NOT (sleep_data ? 'napDuration') OR NOT (sleep_data ? 'duration')
      `)
      if (Number(legacyData.rows[0].count) !== 0) {
        throw new Error('Legacy sleep fields remain; migration 006 is not confirmed')
      }
      await inTransaction(client, async () => {
        for (const migration of migrations.slice(0, historicalIds.length)) {
          await client.query(
            'INSERT INTO schema_migrations (id, checksum, recorded_retrospectively) VALUES ($1, $2, TRUE)',
            [migration.id, migration.checksum],
          )
        }
      })
      console.log('Recorded confirmed migrations 001–006 without running their SQL')
      return
    }

    for (const migration of migrations.slice(recorded.rows.length)) {
      await inTransaction(client, async () => {
        await client.query(migration.sql)
        await client.query(
          'INSERT INTO schema_migrations (id, checksum, applied_at) VALUES ($1, $2, NOW())',
          [migration.id, migration.checksum],
        )
      })
      console.log(`Applied migration ${migration.file}`)
    }
    console.log('Migrations are up to date')
  } finally {
    // Closing the dedicated session releases its advisory lock, including on failure.
    if (connected) await client.end()
  }
}

if (require.main === module) {
  if (process.env.NODE_ENV !== 'production') config({ path: '.env.local', quiet: true })
  const mode = process.argv[2] === '--baseline-confirmed-001-006'
    ? 'baseline-confirmed-001-006'
    : 'apply'
  const connectionString = process.env.MIGRATION_DATABASE_URL
  if (process.argv.length > 3 || (process.argv.length === 3 && mode === 'apply') || !connectionString) {
    console.error('Usage: MIGRATION_DATABASE_URL=<direct-url> node dist/db/migrate.js [--baseline-confirmed-001-006]')
    process.exitCode = 1
  } else {
    runMigrations({
      connectionString,
      migrationsDir: join(__dirname, '..', '..', 'src', 'db', 'migrations'),
      mode,
      confirmation: process.env.MIGRATION_BASELINE_CONFIRMATION,
    }).catch((error: unknown) => {
      console.error('Migration failed:', error)
      process.exitCode = 1
    })
  }
}

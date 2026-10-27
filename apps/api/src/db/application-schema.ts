import { join } from 'node:path'
import type { Pool } from 'pg'
import { getPendingMigrations, loadMigrations, MigrationError } from './migrate'

// Check the runtime connection before listen(), independently of Pre-Deploy.
export async function verifyApplicationSchema(pool: Pool): Promise<void> {
  const migrations = loadMigrations(join(__dirname, '../../src/db/migrations'))
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query("SET LOCAL statement_timeout = '10s'")
    const journal = await client.query<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM schema_migrations ORDER BY id'
    )
    if (getPendingMigrations(migrations, journal.rows).length) {
      throw new MigrationError('Application schema has pending migrations')
    }
    const shape = await client.query<{ compatible: boolean }>(`
      WITH expected(table_name, column_name, data_type, is_nullable) AS (VALUES
        ('sleep_records', 'user_id', 'uuid', 'NO'),
        ('sleep_records', 'date', 'date', 'NO'),
        ('sleep_records', 'bedtime', 'timestamp without time zone', 'YES'),
        ('sleep_records', 'wake_time', 'timestamp without time zone', 'YES'),
        ('sleep_records', 'nap_minutes', 'integer', 'YES'),
        ('habit_marks', 'user_id', 'uuid', 'NO'),
        ('habit_marks', 'date', 'date', 'NO'),
        ('habit_marks', 'habit_id', 'uuid', 'NO'),
        ('habit_marks', 'value', 'boolean', 'NO'),
        ('habits', 'id', 'uuid', 'NO'),
        ('habits', 'user_id', 'uuid', 'NO'),
        ('habits', 'label', 'character varying', 'NO'),
        ('habits', 'created_at', 'timestamp without time zone', 'YES'),
        ('habits', 'start_date', 'date', 'YES'),
        ('habits', 'archived', 'boolean', 'NO'),
        ('daily_entries', 'id', 'character varying', 'NO'),
        ('daily_entries', 'user_id', 'uuid', 'NO'),
        ('daily_entries', 'date', 'character varying', 'NO'),
        ('daily_entries', 'created_at', 'timestamp without time zone', 'YES'),
        ('daily_entries', 'updated_at', 'timestamp without time zone', 'YES')
      ), actual AS (
        SELECT table_name::text, column_name::text, data_type::text, is_nullable::text
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name IN ('sleep_records', 'habit_marks', 'habits', 'daily_entries')
      ), required_constraints(table_name, definition) AS (VALUES
        ('sleep_records', 'PRIMARY KEY (user_id, date)'),
        ('sleep_records', 'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE'),
        ('habit_marks', 'PRIMARY KEY (user_id, date, habit_id)'),
        ('habit_marks', 'FOREIGN KEY (user_id, habit_id) REFERENCES habits(user_id, id) ON DELETE CASCADE'),
        ('habits', 'UNIQUE (user_id, id)')
      )
      SELECT NOT EXISTS (
        (SELECT * FROM expected EXCEPT SELECT * FROM actual)
        UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
      ) AND NOT EXISTS (
        SELECT 1 FROM required_constraints required
        WHERE NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          WHERE c.conrelid = to_regclass(required.table_name)
            AND c.convalidated AND NOT c.condeferrable
            AND pg_get_constraintdef(c.oid) = required.definition
        )
      ) AS compatible
    `)
    if (shape.rows[0]?.compatible !== true) {
      throw new MigrationError(
        'Application schema differs from the expected statistics model'
      )
    }
    await client.query('COMMIT')
  } finally {
    // A failed read-only transaction must not return to the runtime pool.
    client.release(true)
  }
}

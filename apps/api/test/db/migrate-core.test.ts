import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Client } from 'pg'
import { getMigrationStatus, getPendingMigrations, loadMigrations, runMigrations } from '../../src/db/migrate'

function fixture(t: import('node:test').TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'sadhana-migration-core-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, '001_first.sql'), 'SELECT 1;\n')
  writeFileSync(join(dir, '002_second.sql'), 'SELECT 2;\n')
  return dir
}

test('migration files have consecutive IDs and checksums of their exact bytes', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sadhana-migration-core-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  writeFileSync(join(dir, '001_first.sql'), 'SELECT 1;\n')
  writeFileSync(join(dir, '002_second.sql'), 'SELECT 2;\n')
  const migrations = loadMigrations(dir)
  assert.deepEqual(migrations.map(({ id }) => id), ['001', '002'])
  assert.equal(migrations[0].checksum, 'b4e0497804e46e0a0b0b8c31975b062152d551bac49c3c2e80932567b4085dcd')

  writeFileSync(join(dir, '001_first.sql'), 'SELECT 1;\n ')
  assert.notEqual(loadMigrations(dir)[0].checksum, migrations[0].checksum)

  rmSync(join(dir, '002_second.sql'))
  writeFileSync(join(dir, '003_third.sql'), 'SELECT 3;\n')
  assert.throws(() => loadMigrations(dir), /unique sequence from 001/)
})

test('migration journal accepts only an unchanged prefix and selects the remaining files', (t) => {
  const migrations = loadMigrations(fixture(t))
  const recorded = migrations.slice(0, 1).map(({ id, checksum }) => ({ id, checksum }))

  assert.deepEqual(getPendingMigrations(migrations, recorded).map(({ id }) => id), ['002'])
  assert.deepEqual(getPendingMigrations(migrations, migrations), [])
  assert.throws(() => getPendingMigrations(migrations, [{ ...recorded[0], checksum: '0'.repeat(64) }]), /checksum changed/)
  assert.throws(() => getPendingMigrations(migrations, [migrations[1]]), /out-of-sequence/)
  assert.throws(() => getPendingMigrations(migrations, [...migrations, { id: '999', checksum: '0'.repeat(64) }]), /Unknown/)
})

test('migration command rejects a pooled URL and an unconfirmed baseline before connecting', async (t) => {
  const sourceDir = fixture(t)
  const directUrl = 'postgresql://fixture:fixture@db.example.test/app'
  await assert.rejects(
    runMigrations({ connectionString: directUrl.replace('db.', 'db-pooler.'), migrationsDir: sourceDir }),
    /direct PostgreSQL connection/,
  )
  await assert.rejects(
    runMigrations({ connectionString: directUrl, migrationsDir: sourceDir, mode: 'baseline-confirmed-001-006' }),
    /explicit confirmation/,
  )
})


test('status reads an empty database without creating a journal or running SQL', async (t) => {
  const sourceDir = fixture(t)
  t.mock.method(Client.prototype, 'connect', async () => undefined)
  t.mock.method(Client.prototype, 'end', async () => undefined)
  const query = t.mock.method(Client.prototype, 'query', async (sql: string) => {
    if (sql.includes('to_regclass')) return { rows: [{ exists: null }] }
    if (sql.includes('pg_class')) return { rows: [{ exists: false }] }
    if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] }
    throw new Error(`Unexpected status query: ${sql}`)
  })
  const status = await getMigrationStatus({
    connectionString: 'postgresql://fixture:fixture@db.example.test/app',
    migrationsDir: sourceDir,
  })
  assert.equal(status.journalExists, false)
  assert.deepEqual(status.applied, [])
  assert.deepEqual(status.pending, loadMigrations(sourceDir).map(({ id }) => id))
  assert.ok(query.mock.calls.every(({ arguments: [sql] }) => !/CREATE|INSERT|UPDATE|DELETE/.test(sql)))
})

test('an absent target version is refused before opening a connection', async (t) => {
  const migrationsDir = fixture(t)
  const connect = t.mock.method(Client.prototype, 'connect', async () => { throw new Error('Unexpected connection') })
  await assert.rejects(runMigrations({
    connectionString: 'postgresql://fixture:fixture@db.example.test/app', migrationsDir, to: '003',
  }), /Target version must exist/)
  assert.equal(connect.mock.callCount(), 0)
})

test('status refuses unjournaled tables, changed checksums and non-prefix history without writes', async (t) => {
  const migrationsDir = fixture(t)
  const migrations = loadMigrations(migrationsDir)
  let journalExists = false
  let recorded: { id: string; checksum: string }[] = []
  t.mock.method(Client.prototype, 'connect', async () => undefined)
  t.mock.method(Client.prototype, 'end', async () => undefined)
  t.mock.method(Client.prototype, 'query', async (sql: string) => {
    if (sql.includes('to_regclass')) return { rows: [{ exists: journalExists ? 'schema_migrations' : null }] }
    if (sql.includes('pg_class')) return { rows: [{ exists: true }] }
    if (sql.startsWith('SELECT id, checksum')) return { rows: recorded }
    if (/^(BEGIN|SET LOCAL|COMMIT)/.test(sql)) return { rows: [] }
    throw new Error(`Unexpected status query: ${sql}`)
  })
  const options = { connectionString: 'postgresql://fixture:fixture@db.example.test/app', migrationsDir }
  await assert.rejects(getMigrationStatus(options), /no migration journal/)
  journalExists = true
  recorded = [{ ...migrations[0], checksum: '0'.repeat(64) }]
  await assert.rejects(getMigrationStatus(options), /checksum changed/)
  recorded = [migrations[1]]
  await assert.rejects(getMigrationStatus(options), /out-of-sequence/)
})

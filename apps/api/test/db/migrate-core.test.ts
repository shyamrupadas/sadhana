import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { getPendingMigrations, loadMigrations, runMigrations } from '../../src/db/migrate'

const sourceDir = join(__dirname, '..', '..', 'src', 'db', 'migrations')

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

test('migration journal accepts only an unchanged prefix and selects the remaining files', () => {
  const migrations = loadMigrations(sourceDir)
  const recorded = migrations.slice(0, 2).map(({ id, checksum }) => ({ id, checksum }))

  assert.deepEqual(getPendingMigrations(migrations, recorded).map(({ id }) => id), migrations.slice(2).map(({ id }) => id))
  assert.deepEqual(getPendingMigrations(migrations, migrations), [])
  assert.throws(() => getPendingMigrations(migrations, [{ ...recorded[0], checksum: '0'.repeat(64) }]), /checksum changed/)
  assert.throws(() => getPendingMigrations(migrations, [recorded[1]]), /out-of-sequence/)
  assert.throws(() => getPendingMigrations(migrations, [...migrations, { id: '007', checksum: '0'.repeat(64) }]), /Unknown/)
})

test('migration command rejects a pooled URL and an unconfirmed baseline before connecting', async () => {
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

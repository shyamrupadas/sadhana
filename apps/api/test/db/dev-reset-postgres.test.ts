import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { Client } from 'pg'
import { loadMigrationTestConfiguration } from '../../src/db/dev-database'
import { resetDevelopmentDatabase } from '../../src/db/dev-reset'
import { verifyDevFixtures } from '../../src/db/dev-fixtures'
import { getMigrationStatus } from '../../src/db/migrate'
import { prepareFixtureSource } from '../../src/db/git-fixture-source'

test('reset recreates only the allowed temporary database from Git and recovers after a failed attempt', async (t) => {
  if (
    process.env.MIGRATION_DB_TEST !== '1' ||
    process.env.MIGRATION_DB_TEST_TARGET !== 'test'
  ) {
    t.skip(
      'Run pnpm db:test --target test with an independently allowed resetDatabase and maintenanceDatabase'
    )
    return
  }
  const config = loadMigrationTestConfiguration('test')
  const { resetDatabase, maintenanceDatabase, database } = config.databaseTarget
  assert.ok(
    resetDatabase && maintenanceDatabase,
    'Explicit test target must allow a temporary resetDatabase and maintenanceDatabase'
  )
  assert.match(resetDatabase, /^[a-zA-Z0-9_-]{1,63}$/)
  assert.notEqual(resetDatabase, database)
  assert.notEqual(resetDatabase, maintenanceDatabase)
  assert.ok(!['postgres', 'template0', 'template1'].includes(resetDatabase))
  const url = new URL(config.MIGRATION_DATABASE_URL)
  url.pathname = `/${resetDatabase}`
  const temporary = {
    ...config,
    DATABASE_URL: url.toString(),
    MIGRATION_DATABASE_URL: url.toString(),
    DEV_FIXTURE_PASSWORD: 'local-reset-fixture-only',
    databaseTarget: { ...config.databaseTarget, database: resetDatabase },
    databaseIdentity: { ...config.databaseIdentity, database: resetDatabase },
  }
  const maintenanceUrl = new URL(config.MIGRATION_DATABASE_URL)
  maintenanceUrl.pathname = `/${maintenanceDatabase}`
  const service = new Client({ connectionString: maintenanceUrl.toString() })
  const withTarget = async (action: (client: Client) => Promise<void>) => {
    const client = new Client({ connectionString: url.toString() })
    try {
      await client.connect()
      await action(client)
    } finally {
      await client.end()
    }
  }
  try {
    await service.connect()
    // Refuse to take over an existing resource, even on this explicitly configured test target.
    assert.equal(
      (await service.query('SELECT 1 FROM pg_database WHERE datname=$1', [resetDatabase]))
        .rowCount,
      0
    )
    await service.query(`CREATE DATABASE "${resetDatabase}" TEMPLATE template0`)
    t.after(async () => {
      const cleanup = new Client({ connectionString: maintenanceUrl.toString() })
      try {
        await cleanup.connect()
        await cleanup.query(`DROP DATABASE IF EXISTS "${resetDatabase}"`)
      } finally {
        await cleanup.end()
      }
    })
    await withTarget(async (client) => {
      await client.query(
        'CREATE TABLE existing_work (value int); INSERT INTO existing_work VALUES (42)'
      )
    })
    const sourceRef = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: join(__dirname, '../../../..'),
      encoding: 'utf8',
    }).trim()
    const request = { sourceRef, to: '006', date: '2026-01-02' }
    await assert.rejects(
      resetDevelopmentDatabase(temporary, {
        ...request,
        sourceRef: 'unavailable-source',
      }),
      /preparation.*preserved/i
    )
    await withTarget(async (client) => {
      assert.deepEqual((await client.query('SELECT * FROM existing_work')).rows, [
        { value: 42 },
      ])
    })
    // An active application session refuses before DROP and is never forcibly terminated.
    await withTarget(async (client) => {
      await assert.rejects(
        resetDevelopmentDatabase(temporary, request),
        /preparation.*preserved/i
      )
      assert.deepEqual((await client.query('SELECT * FROM existing_work')).rows, [
        { value: 42 },
      ])
    })
    const result = await resetDevelopmentDatabase(temporary, request)
    assert.deepEqual(result, {
      commit: sourceRef,
      generator: '1',
      schema: '006',
      date: request.date,
    })
    const options = {
      connectionString: url.toString(),
      migrationsDir: join(__dirname, '../../src/db/migrations'),
    }
    assert.equal((await getMigrationStatus(options)).applied.at(-1), '006')
    await verifyDevFixtures({ ...options, date: request.date })
    await withTarget(async (client) => {
      assert.equal(
        (await client.query("SELECT to_regclass('existing_work') AS table")).rows[0]
          .table,
        null
      )
      assert.equal(
        (await client.query('SELECT count(*)::int AS count FROM users')).rows[0].count,
        3
      )
    })

    // A SQL failure after recreation leaves a known partial version; the next real reset recovers.
    const prepareBroken = async (input: Parameters<typeof prepareFixtureSource>[0]) => {
      const source = await prepareFixtureSource(input)
      writeFileSync(
        join(source.migrationsDir, '006_set_duration_min_null_for_missing_times.sql'),
        'SELECT missing_reset_test_function();'
      )
      return source
    }
    // Use the real maintenance path; replace only source preparation to inject this SQL failure.
    await assert.rejects(
      resetDevelopmentDatabase(temporary, request, {
        prepareSource: prepareBroken,
      }),
      /stage=migrate; version=005/
    )
    await resetDevelopmentDatabase(temporary, request)
    await verifyDevFixtures({ ...options, date: request.date })
    assert.equal(
      (await service.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]))
        .rowCount,
      1
    )
  } finally {
    await service.end()
  }
})

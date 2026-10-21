import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Configuration } from '../../src/config/environment'
import { prepareRehearsalTarget } from '../../src/db/rehearsal-checks'
import { rehearseDevelopmentDatabase } from '../../src/db/dev-rehearse'

const config: Configuration = {
  DB_ENVIRONMENT: 'dev',
  DATABASE_URL: 'postgres://fixture:private@db.invalid/dev',
  MIGRATION_DATABASE_URL: 'postgres://fixture:private@db.invalid/dev',
  JWT_SECRET: 'private-jwt',
  JWT_REFRESH_SECRET: 'private-refresh',
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
  CORS_ORIGIN: 'http://localhost:5173',
  DEV_FIXTURE_PASSWORD: 'private-fixture',
  databaseTarget: {
    directHost: 'db.invalid',
    runtimeHost: 'db.invalid',
    port: 5432,
    database: 'dev',
    role: 'fixture',
  },
  databaseIdentity: {
    environment: 'dev',
    host: 'db.invalid',
    database: 'dev',
    role: 'fixture',
  },
}
const request = {
  sourceRef: 'HEAD',
  from: '006',
  to: '007',
  date: '2026-01-02',
  checks: 'profile-kind',
}

test('rehearsal preserves existing work on invalid targets, unavailable checks, unsupported SQL or changed source prefix', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'sadhana-rehearsal-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const sql = join(directory, 'sql')
  const checks = join(directory, 'checks')
  const changedSource = join(directory, 'changed-source')
  const sourceSql = join(__dirname, '../../src/db/migrations')
  mkdirSync(sql)
  for (const name of readdirSync(sourceSql).filter((name) => name.slice(0, 3) <= '006')) {
    cpSync(join(sourceSql, name), join(sql, name))
  }
  mkdirSync(checks)
  cpSync(sql, changedSource, { recursive: true })
  writeFileSync(
    join(changedSource, '006_set_duration_min_null_for_missing_times.sql'),
    'SELECT 1;'
  )
  writeFileSync(join(sql, '007_outside.sql'), 'CREATE TABLE outside.unexpected (id int);')
  let sourceCleaned = 0
  let connections = 0
  for (const failure of [
    'target',
    'source',
    'missing-checks',
    'incomplete-checks',
    'incompatible-checks',
    'scope',
    'prefix',
  ]) {
    writeFileSync(
      join(checks, 'profile-kind.json'),
      JSON.stringify(
        failure === 'incomplete-checks'
          ? { from: '006', to: '007', source: [] }
          : {
              from: '006',
              to: failure === 'incompatible-checks' ? '008' : '007',
              source: [{ sql: 'SELECT 1', rows: [{ value: 1 }] }],
              schema: [{ sql: 'SELECT 1', rows: [] }],
              data: [{ sql: 'SELECT 1', rows: [] }],
              preservation: [{ sql: 'SELECT 1', rows: [] }],
            }
      )
    )
    await assert.rejects(
      rehearseDevelopmentDatabase(
        failure === 'target' ? { ...config, DB_ENVIRONMENT: 'production' } : config,
        { ...request, checks: failure === 'missing-checks' ? 'absent' : request.checks },
        {
          prepareSource: async () => {
            if (failure === 'source') throw new Error('private diagnostic')
            return {
              commit: 'a'.repeat(40),
              generator: '1',
              directory,
              migrationsDir:
                failure === 'prefix'
                  ? changedSource
                  : join(__dirname, '../../src/db/migrations'),
              seed: async () => assert.fail('Existing work must be preserved'),
              verify: async () => undefined,
              cleanup: async () => {
                sourceCleaned++
              },
            }
          },
          prepareTarget: async (options) => {
            return prepareRehearsalTarget({
              ...options,
              migrationsDir: sql,
              checksDir: checks,
            })
          },
          structure: () => {
            connections++
            return assert.fail('Preflight must not reach the database')
          },
        }
      ),
      /preparation.*preserved/i
    )
  }
  assert.equal(connections, 0)
  assert.equal(sourceCleaned, 5)
})

test('rehearsal verifies old records, transformed data and a stable full journal; any failed stage is unsuccessful', async () => {
  for (const failure of [
    'rights',
    'source',
    'migrate',
    'schema',
    'data',
    'preservation',
    'repeat',
    'unreadable',
    'none',
  ]) {
    let state = 'previous work'
    let cleaned = 0
    let cleared = false
    let snapshots = 0
    let sourceChecked = false
    let migrated = 0
    const fail = (stage: string) => {
      if (failure === stage) throw new Error('postgres://private JWT password row data')
    }
    const run = () =>
      rehearseDevelopmentDatabase(config, request, {
        prepareSource: async () => ({
          commit: 'a'.repeat(40),
          generator: '1',
          directory: '/prepared',
          migrationsDir: '/source/sql',
          seed: async () => {
            assert.equal(state, '006')
            state = 'old records'
          },
          verify: async () => {
            assert.equal(state, 'old records')
          },
          cleanup: async () => {
            cleaned++
          },
        }),
        prepareTarget: async () => ({
          migrationsDir: '/frozen/sql',
          check: async (phase) => {
            assert.equal(
              state,
              phase === 'source' ? 'old records' : 'transformed records'
            )
            fail(phase)
            if (phase === 'source') sourceChecked = true
          },
          snapshot: async () => {
            snapshots++
            if (failure === 'unreadable') throw new Error('private snapshot')
            return {
              records: ['transformed'],
              journal: [
                {
                  id: '007',
                  recorded_at:
                    failure === 'repeat' && snapshots === 2
                      ? 'changed timestamp'
                      : 'original timestamp',
                },
              ],
            }
          },
          cleanup: async () => {
            cleaned++
          },
        }),
        structure: () => ({
          check: async () => {
            fail('rights')
          },
          reset: async () => {
            cleared = true
            state = 'empty'
          },
          close: async () => undefined,
        }),
        migrate: async ({ to }) => {
          if (to === '006') {
            state = '006'
            return
          }
          assert.equal(sourceChecked, true)
          fail('migrate')
          state = 'transformed records'
          migrated++
        },
        status: async () => {
          if (failure === 'unreadable') throw new Error('private connection')
          return {
            journalExists: true,
            applied: [
              '001',
              '002',
              '003',
              '004',
              '005',
              '006',
              ...(migrated ? ['007'] : []),
            ],
            pending: [],
          }
        },
      })
    if (failure === 'none') {
      const result = await run()
      assert.equal(state, 'transformed records')
      assert.equal(migrated, 2)
      assert.deepEqual(result.results, [
        'restore',
        'source',
        'migrate',
        'schema',
        'data',
        'preservation',
        'repeat',
      ])
      assert.equal(result.commit, 'a'.repeat(40))
      assert.equal(result.to, '007')
    } else {
      await assert.rejects(run(), (error: Error) => {
        assert.match(
          error.message,
          failure === 'rights'
            ? /preparation.*preserved/
            : failure === 'unreadable'
              ? /stage=snapshot; public schema state unreadable/
              : new RegExp(`stage=${failure}; version=${migrated ? '007' : '006'}`)
        )
        assert.doesNotMatch(error.message, /private|JWT|password|postgres:/)
        return true
      })
      if (failure === 'rights') assert.equal(state, 'previous work')
    }
    assert.equal(cleared, failure !== 'rights')
    assert.equal(cleaned, 2)
  }
})

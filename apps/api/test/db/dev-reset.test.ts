import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client } from 'pg'
import type { Configuration } from '../../src/config/environment'
import { resetDevelopmentDatabase, type ResetOperations } from '../../src/db/dev-reset'
import type { PreparedFixtureSource } from '../../src/db/git-fixture-source'

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
const request = { sourceRef: 'HEAD', to: '006', date: '2026-01-02' }

test('reset rejects invalid targets and incomplete inputs before preparing or connecting', async () => {
  for (const invalid of [
    { ...config, DB_ENVIRONMENT: 'production' as const },
    {
      ...config,
      MIGRATION_DATABASE_URL: 'postgres://fixture:private@foreign.invalid/dev',
    },
    {
      ...config,
      MIGRATION_DATABASE_URL: `${config.MIGRATION_DATABASE_URL}?options=-csearch_path=public`,
    },
    { ...config, DEV_FIXTURE_PASSWORD: '' },
    {
      ...config,
      databaseTarget: { ...config.databaseTarget, database: 'postgres' },
    },
  ]) {
    await assert.rejects(
      resetDevelopmentDatabase(invalid, request, {
        prepareSource: async () =>
          assert.fail('Invalid inputs must not prepare a source'),
        structure: () => assert.fail('Invalid inputs must not connect'),
      }),
      /preparation.*preserved/i
    )
  }
})

test('public reset refuses missing rights, unsupported extensions and external dependencies before cleanup', async (t) => {
  let cleared = false
  t.mock.method(Client.prototype, 'connect', async () => undefined)
  t.mock.method(Client.prototype, 'end', async () => undefined)
  let failure = ''
  t.mock.method(Client.prototype, 'query', async (sql: string) => {
    if (sql.startsWith('DROP SCHEMA')) cleared = true
    if (sql.includes('AS correct_target'))
      return {
        rows: [
          {
            correct_target: true,
            owns_schema: failure !== 'rights',
            can_create: true,
            extension_available: true,
            idle: failure !== 'sessions',
          },
        ],
      }
    if (sql.includes('FROM pg_extension'))
      return { rows: failure === 'extension' ? [{ extname: 'hstore' }] : [] }
    if (sql.includes("to_regnamespace('public')"))
      return { rows: [{ namespace: 'public' }] }
    if (sql.includes('WITH RECURSIVE'))
      return { rows: [{ outside: failure === 'dependency' }] }
    return { rows: [] }
  })
  for (failure of ['rights', 'sessions', 'extension', 'dependency']) {
    await assert.rejects(
      resetDevelopmentDatabase(config, request, {
        prepareSource: async () => ({
          commit: 'a'.repeat(40),
          generator: '1',
          directory: '/prepared',
          migrationsDir: '/prepared/sql',
          seed: async () => assert.fail('Must preserve data'),
          verify: async () => assert.fail('Must preserve data'),
          cleanup: async () => undefined,
        }),
      }),
      /preparation.*preserved/i
    )
    assert.equal(cleared, false)
  }
})

test('reset preserves the existing database on every preparation failure and cleans prepared code', async () => {
  for (const failure of ['source', 'privileges']) {
    let database = 'existing work'
    let cleaned = false
    let closed = false
    const source = {
      commit: 'a'.repeat(40),
      generator: '1',
      directory: '/prepared',
      migrationsDir: '/prepared/sql',
      seed: async () => undefined,
      verify: async () => undefined,
      cleanup: async () => {
        cleaned = true
      },
    } satisfies PreparedFixtureSource
    const operations: ResetOperations = {
      prepareSource: async () => {
        if (failure === 'source') throw new Error('private source details')
        return source
      },
      structure: () => ({
        check: async () => {
          throw new Error('private role details')
        },
        reset: async () => {
          database = 'empty'
        },
        close: async () => {
          closed = true
        },
      }),
      migrate: async () => undefined,
      status: async () => ({ journalExists: true, applied: [], pending: [] }),
    }
    await assert.rejects(
      resetDevelopmentDatabase(config, request, operations),
      /preparation.*preserved/i
    )
    assert.equal(database, 'existing work')
    assert.equal(cleaned, failure !== 'source')
    assert.equal(closed, failure !== 'source')
  }
})

test('reset reports the failed stage and observed version without leaking diagnostics, and can be repeated', async () => {
  for (const failure of ['clear', 'migrate', 'seed', 'verify', 'none']) {
    let database: string | null = 'existing work'
    let cleaned = false
    let closed = false
    const fail = (stage: string) => {
      if (failure === stage) throw new Error('postgres://private JWT SQL contents')
    }
    const operations: ResetOperations = {
      prepareSource: async () => ({
        commit: 'a'.repeat(40),
        generator: '1',
        directory: '/prepared',
        migrationsDir: '/prepared/sql',
        seed: async () => {
          fail('seed')
          database = '006 seeded'
        },
        verify: async () => {
          fail('verify')
          assert.equal(database, '006 seeded')
        },
        cleanup: async () => {
          cleaned = true
        },
      }),
      structure: () => ({
        check: async () => undefined,
        reset: async () => {
          fail('clear')
          database = 'empty'
        },
        close: async () => {
          closed = true
        },
      }),
      migrate: async () => {
        database = '002'
        fail('migrate')
        database = '006'
      },
      status: async () => {
        if (database === null) throw new Error('Database missing')
        return {
          journalExists: true,
          applied:
            database === '002'
              ? ['001', '002']
              : database.startsWith('006')
                ? ['001', '002', '003', '004', '005', '006']
                : [],
          pending: [],
        }
      },
    }
    if (failure === 'none') {
      const result = await resetDevelopmentDatabase(config, request, operations)
      assert.deepEqual(result, {
        commit: 'a'.repeat(40),
        generator: '1',
        schema: '006',
        date: request.date,
      })
      assert.equal(database, '006 seeded')
    } else {
      await assert.rejects(
        resetDevelopmentDatabase(config, request, operations),
        (error: Error) => {
          assert.match(error.message, new RegExp(`stage=${failure}`))
          if (failure === 'migrate') assert.match(error.message, /version=002/)
          assert.doesNotMatch(error.message, /private|JWT|SQL|postgres:/)
          return true
        }
      )
    }
    assert.equal(cleaned, true)
    assert.equal(closed, true)
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import Fastify from 'fastify'
import pg from 'pg'
import app from '../../src/app'
import { verifyApplicationSchema } from '../../src/db/application-schema'
import { loadMigrations } from '../../src/db/migrate'
import { join } from 'node:path'
import * as applicationSchema from '../../src/db/application-schema'

test('runtime app refuses readiness when schema verification fails', async (t) => {
  const previous = { ...process.env }
  t.after(() => {
    process.env = previous
  })
  Object.assign(process.env, {
    DB_ENVIRONMENT: 'test',
    DATABASE_URL: 'postgres://fixture:fixture@db.invalid/app',
    MIGRATION_DATABASE_URL: 'postgres://fixture:fixture@db.invalid/app',
    JWT_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
  })
  const verification = t.mock.method(
    applicationSchema,
    'verifyApplicationSchema',
    async (pool: pg.Pool) => {
      assert.ok(pool instanceof pg.Pool)
      throw new Error('Schema not ready')
    }
  )
  const server = Fastify()
  t.after(() => server.close())
  server.register(app, { verifySchema: true })
  await assert.rejects(async () => {
    await server.ready()
  }, /Schema not ready/)
  assert.equal(verification.mock.callCount(), 1)
  assert.equal(server.server.listening, false)
})

test('application readiness requires the complete migration journal and expected schema', async (t) => {
  const journal = loadMigrations(join(__dirname, '../../src/db/migrations')).map(
    ({ id, checksum }) => ({ id, checksum })
  )
  for (const scenario of [
    { name: 'current schema', journal, compatible: true, error: null },
    {
      name: 'pending migration',
      journal: journal.slice(0, -1),
      compatible: true,
      error: /pending migrations/,
    },
    {
      name: 'changed schema',
      journal,
      compatible: false,
      error: /differs from the expected/,
    },
    {
      name: 'changed checksum',
      journal: [{ ...journal[0], checksum: 'changed' }, ...journal.slice(1)],
      compatible: true,
      error: /checksum changed/,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const statements: string[] = []
      let released = false
      const pool = {
        async connect() {
          return {
            async query(sql: string) {
              statements.push(sql)
              return {
                rows: sql.startsWith('SELECT id, checksum')
                  ? scenario.journal
                  : [{ compatible: scenario.compatible }],
              }
            },
            release(destroy: boolean) {
              released = destroy
            },
          }
        },
      } as unknown as pg.Pool
      if (scenario.error)
        await assert.rejects(verifyApplicationSchema(pool), scenario.error)
      else await verifyApplicationSchema(pool)
      assert.equal(statements.includes('COMMIT'), scenario.error === null)
      assert.equal(released, true)
    })
  }
})

test('API rejects a foreign target before constructing a database pool and hides secrets', async (t) => {
  const previous = { ...process.env }
  t.after(() => {
    process.env = previous
  })
  Object.assign(process.env, {
    DB_ENVIRONMENT: 'test',
    DATABASE_URL: 'postgres://fixture:private-password@foreign.invalid/app',
    MIGRATION_DATABASE_URL: 'postgres://fixture:private-password@db.invalid/app',
    JWT_SECRET: 'private-jwt',
    JWT_REFRESH_SECRET: 'private-refresh',
  })
  const pool = t.mock.method(pg, 'Pool', () => {
    throw new Error('Must not create a pool')
  })
  const server = Fastify()
  t.after(() => server.close())
  server.register(app)
  await assert.rejects(
    async () => {
      await server.ready()
    },
    (error: Error) => {
      assert.match(error.message, /Invalid DATABASE_URL/)
      assert.doesNotMatch(error.message, /private-|postgres:\/\//)
      return true
    }
  )
  assert.equal(pool.mock.callCount(), 0)
})

test('local API and migration entrypoints reject production context from any working directory', async () => {
  const { spawnSync } = await import('node:child_process')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const apiRoot = join(__dirname, '..', '..')
  for (const entry of ['dev.ts', 'db/dev-migrate.ts']) {
    const result = spawnSync(
      process.execPath,
      ['-r', require.resolve('ts-node/register'), join(apiRoot, 'src', entry)],
      {
        cwd: tmpdir(),
        encoding: 'utf8',
        env: {
          ...process.env,
          TS_NODE_PROJECT: join(apiRoot, 'tsconfig.json'),
          NODE_ENV: 'production',
          DB_ENVIRONMENT: 'production',
          DATABASE_URL: 'postgres://private:private@production.invalid/live',
          JWT_SECRET: 'private-jwt',
          JWT_REFRESH_SECRET: 'private-refresh',
        },
      }
    )
    assert.equal(result.status, 1)
    assert.match(result.stdout + result.stderr, /conflicts with the fixed launch context/)
    assert.doesNotMatch(result.stdout + result.stderr, /private|postgres:\/\//)
  }
})

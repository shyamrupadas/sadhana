import assert from 'node:assert/strict'
import { test } from 'node:test'
import Fastify from 'fastify'
import pg from 'pg'
import app from '../../src/app'

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

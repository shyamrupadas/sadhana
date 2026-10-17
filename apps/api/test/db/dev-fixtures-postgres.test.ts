import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import Fastify, { type FastifyInstance } from 'fastify'
import { Client, Pool } from 'pg'
import { loadMigrationTestConfiguration } from '../../src/db/dev-database'
import { runMigrations } from '../../src/db/migrate'
import { seedDevFixtures, verifyDevFixtures } from '../../src/db/dev-fixtures'
import { createApiHandlers } from '../../src/api-handlers'
import cookiePlugin from '../../src/plugins/cookie'
import jwtPlugin from '../../src/plugins/jwt'
import authRoutes from '../../src/routes/auth'
import sleepRoutes from '../../src/routes/sleep-records'

const migrationsDir = join(__dirname, '../../src/db/migrations')
const date = '2026-01-02'
const password = 'fixture-local-test-password'

async function withDatabase(
  t: TestContext,
  action: (client: Client, connectionString: string) => Promise<void>
) {
  if (process.env.MIGRATION_DB_TEST !== '1') {
    t.skip('Run pnpm db:test --target <dev|test> for PostgreSQL scenarios')
    return
  }
  const target = process.env.MIGRATION_DB_TEST_TARGET
  if (target !== 'dev' && target !== 'test')
    throw new Error('Explicit database test target required')
  const config = loadMigrationTestConfiguration(target)
  const schema = `fixture_test_${randomUUID().replaceAll('-', '')}`
  const client = new Client({ connectionString: config.MIGRATION_DATABASE_URL })
  try {
    await client.connect()
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}"`)
    const url = new URL(config.MIGRATION_DATABASE_URL)
    url.searchParams.set('options', `-csearch_path=${schema}`)
    await action(client, url.toString())
  } finally {
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    } finally {
      await client.end()
    }
  }
}

async function authApp(connectionString: string) {
  const app = Fastify()
  const pool = new Pool({ connectionString })
  app.addHook('onClose', async () => pool.end())
  app.decorate('pg', pool as unknown as FastifyInstance['pg'])
  app.decorate('config', {
    JWT_SECRET: 'fixture-test-access',
    JWT_REFRESH_SECRET: 'fixture-test-refresh',
    JWT_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
  } as FastifyInstance['config'])
  await app.register(cookiePlugin)
  await app.register(jwtPlugin)
  app.decorate('apiHandlers', createApiHandlers(app))
  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(sleepRoutes, { prefix: '/sleep-records' })
  await app.ready()
  return app
}

test('PostgreSQL fixtures preserve known stored records, normal login and application edits across restart', async (t) => {
  await withDatabase(t, async (client, connectionString) => {
    const options = { connectionString, migrationsDir, date, password }
    await runMigrations(options)
    await seedDevFixtures(options)
    await verifyDevFixtures(options)
    const users = (
      await client.query('SELECT id, email, password_hash FROM users ORDER BY email')
    ).rows
    assert.deepEqual(
      users.map(({ email }) => email),
      ['daily@example.test', 'empty@example.test', 'history@example.test']
    )
    assert.ok(
      users.every(
        ({ password_hash }) =>
          password_hash.startsWith('$2b$10$') && password_hash !== password
      )
    )
    assert.equal(new Set(users.map(({ password_hash }) => password_hash)).size, 3)
    const daily = users.find(({ email }) => email === 'daily@example.test')!
    const empty = users.find(({ email }) => email === 'empty@example.test')!
    assert.deepEqual(
      (
        await client.query(
          'SELECT key, label FROM habits WHERE user_id = $1 ORDER BY key',
          [daily.id]
        )
      ).rows,
      [
        { key: 'reading', label: 'Чтение' },
        { key: 'walk', label: 'Прогулка' },
      ]
    )
    for (const table of ['habits', 'daily_entries']) {
      assert.equal(
        (
          await client.query(
            `SELECT count(*)::int AS count FROM ${table} WHERE user_id = $1`,
            [empty.id]
          )
        ).rows[0].count,
        0
      )
    }
    const known = (
      await client.query(
        'SELECT id, date, sleep_data, habits FROM daily_entries WHERE user_id = $1 AND date = $2',
        [daily.id, '2025-12-07']
      )
    ).rows[0]
    assert.deepEqual(known, {
      id: `${daily.id}-2025-12-07`,
      date: '2025-12-07',
      sleep_data: {
        bedtime: '2025-12-07 23:00',
        wakeTime: '2025-12-07 07:00',
        napDuration: 30,
        duration: 510,
      },
      habits: [],
    })
    let app = await authApp(connectionString)
    try {
      let accessToken = ''
      for (const user of users) {
        const login = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: user.email, password },
        })
        assert.equal(login.statusCode, 200)
        assert.deepEqual(login.json().user, { id: user.id, email: user.email })
        assert.match(login.headers['set-cookie'] as string, /HttpOnly/)
        if (user.id === daily.id) accessToken = login.json().accessToken
      }
      const wrong = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: daily.email, password: 'incorrect' },
      })
      assert.equal(wrong.statusCode, 401)
      const edit = await app.inject({
        method: 'PATCH',
        url: `/sleep-records/${date}/habits/walk`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { value: false },
      })
      assert.equal(edit.statusCode, 200)
      const before = (await client.query('SELECT * FROM daily_entries ORDER BY id')).rows
      await assert.rejects(seedDevFixtures(options), /empty application/)
      await assert.rejects(verifyDevFixtures(options), /differ/)
      await app.close()
      app = await authApp(connectionString)
      assert.deepEqual(
        (await client.query('SELECT * FROM daily_entries ORDER BY id')).rows,
        before
      )
      const refreshed = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: {
          cookie: (
            await app.inject({
              method: 'POST',
              url: '/auth/login',
              payload: { email: daily.email, password },
            })
          ).cookies
            .map(({ name, value }) => `${name}=${value}`)
            .join('; '),
        },
      })
      assert.equal(refreshed.statusCode, 200)
    } finally {
      await app.close()
    }
  })
})

test('PostgreSQL fixture failure rolls back users, habits and earlier daily entries', async (t) => {
  await withDatabase(t, async (client, connectionString) => {
    await runMigrations({ connectionString, migrationsDir })
    await client.query(
      `CREATE FUNCTION reject_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.date = '2026-01-02' THEN RAISE EXCEPTION 'private SQL details'; END IF; RETURN NEW; END $$`
    )
    await client.query(
      'CREATE TRIGGER reject_fixture BEFORE INSERT ON daily_entries FOR EACH ROW EXECUTE FUNCTION reject_fixture()'
    )
    await assert.rejects(
      seedDevFixtures({ connectionString, migrationsDir, date, password }),
      (error: Error) => {
        assert.match(error.message, /no partial dataset/)
        assert.doesNotMatch(error.message, /private|postgres:|fixture-local/)
        return true
      }
    )
    for (const table of ['users', 'habits', 'daily_entries']) {
      assert.equal(
        (await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count,
        0
      )
    }
    assert.equal(
      (await client.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0]
        .count,
      6
    )
  })
})

test('PostgreSQL fixtures refuse an earlier schema without applying migrations or records', async (t) => {
  await withDatabase(t, async (client, connectionString) => {
    await runMigrations({ connectionString, migrationsDir, to: '005' })
    const before = (await client.query('SELECT * FROM schema_migrations ORDER BY id'))
      .rows
    await assert.rejects(
      seedDevFixtures({ connectionString, migrationsDir, date, password }),
      /schema 006/
    )
    assert.deepEqual(
      (await client.query('SELECT * FROM schema_migrations ORDER BY id')).rows,
      before
    )
    assert.equal(
      (await client.query('SELECT count(*)::int AS count FROM users')).rows[0].count,
      0
    )
  })
})

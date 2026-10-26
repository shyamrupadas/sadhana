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
import habitsRoutes from '../../src/routes/habits'
import statisticsRoutes from '../../src/routes/statistics'
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
  await app.register(habitsRoutes, { prefix: '/habits' })
  await app.register(statisticsRoutes, { prefix: '/statistics' })
  await app.ready()
  return app
}

async function waitForBlockedRequest(client: Client) {
  const deadline = Date.now() + 10_000
  while (
    !(
      await client.query(
        'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pg_backend_pid() = ANY(pg_blocking_pids(pid))) AS waiting'
      )
    ).rows[0].waiting
  ) {
    assert.ok(Date.now() < deadline, 'Request must reach the controlled database barrier')
  }
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
          'SELECT label FROM habits WHERE user_id = $1 ORDER BY label',
          [daily.id]
        )
      ).rows,
      [
        { label: 'Прогулка' },
        { label: 'Чтение' },
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
    const history = users.find(({ email }) => email === 'history@example.test')!
    const archived = (await client.query(
      `SELECT h.label, count(*) FILTER (WHERE m.value)::int AS done,
        count(*) FILTER (WHERE NOT m.value)::int AS failed, max(m.date)::text AS last_date
       FROM habits h JOIN habit_marks m ON m.user_id = h.user_id AND m.habit_id = h.id
       WHERE h.user_id = $1 AND h.archived GROUP BY h.id ORDER BY h.label`,
      [history.id]
    )).rows
    assert.deepEqual(archived.map(habit => habit.label), ['Зарядка', 'Медитация'])
    assert.ok(archived.every(habit => habit.done > 100 && habit.failed > 100))
    assert.ok(archived[0].last_date <= '2025-10-04')
    assert.ok(archived[1].last_date <= '2025-07-06')
    await client.query('UPDATE habits SET archived = false WHERE user_id = $1', [history.id])
    await assert.rejects(verifyDevFixtures(options), /differ/)
    await client.query("UPDATE habits SET archived = true WHERE user_id = $1 AND label IN ('Медитация', 'Зарядка')", [history.id])
    await verifyDevFixtures(options)
    const known = (
      await client.query(
        `SELECT d.id, d.date, COALESCE((SELECT jsonb_agg(jsonb_build_object('key', habit_id::text, 'value', value)) FROM habit_marks m WHERE m.user_id=d.user_id AND m.date=d.date::date), '[]') AS habits, to_char(s.bedtime, 'YYYY-MM-DD HH24:MI') AS bedtime, to_char(s.wake_time, 'YYYY-MM-DD HH24:MI') AS wake_time, s.nap_minutes FROM daily_entries d JOIN sleep_records s ON s.user_id = d.user_id AND s.date = d.date::date WHERE d.user_id = $1 AND d.date = $2`,
        [daily.id, '2025-12-07']
      )
    ).rows[0]
    assert.deepEqual(known, {
      id: `${daily.id}-2025-12-07`,
      date: '2025-12-07',
      bedtime: '2025-12-07 23:00',
      wake_time: '2025-12-07 07:00',
      nap_minutes: 30,
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
      const newAccount = { email: 'registered@example.test', password }
      const registered = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: newAccount,
      })
      assert.equal(registered.statusCode, 201)
      assert.equal(
        (await app.inject({ method: 'POST', url: '/auth/login', payload: newAccount }))
          .statusCode,
        200
      )
      assert.equal(
        (await app.inject({ method: 'POST', url: '/auth/register', payload: newAccount }))
          .statusCode,
        400
      )
      await assert.rejects(
        client.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [
          newAccount.email,
          'duplicate-hash',
        ]),
        { code: '23505' }
      )
      await client.query('DELETE FROM users WHERE email = $1', [newAccount.email])
      const wrong = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: daily.email, password: 'incorrect' },
      })
      assert.equal(wrong.statusCode, 401)
      const habitId = (await client.query("SELECT id FROM habits WHERE user_id=$1 AND label='Прогулка'", [daily.id])).rows[0].id
      const edit = await app.inject({
        method: 'PATCH',
        url: `/sleep-records/${date}/habits/${habitId}`,
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
    const journal = (await client.query('SELECT * FROM schema_migrations ORDER BY id'))
      .rows
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
    assert.deepEqual(
      (await client.query('SELECT * FROM schema_migrations ORDER BY id')).rows,
      journal
    )
  })
})

test('concurrent first habit mark preserves sleep saved while the mark is pending', async (t) => {
  await withDatabase(t, async (client, connectionString) => {
    await runMigrations({ connectionString, migrationsDir })
    await seedDevFixtures({ connectionString, migrationsDir, date, password })
    // Pause the mark's INSERT after its initial read, while a sleep request can commit.
    await client.query(`
      CREATE FUNCTION pause_first_mark() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.date = '2026-01-03' THEN
          PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_SCHEMA), 1);
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pause_first_mark BEFORE INSERT ON habit_marks
      FOR EACH ROW EXECUTE FUNCTION pause_first_mark();
      SELECT pg_advisory_lock(hashtext(current_schema()), 1);
    `)
    const app = await authApp(connectionString)
    let mark: Promise<unknown> | undefined
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'empty@example.test', password },
      })
      assert.equal(login.statusCode, 200)
      const headers = { authorization: `Bearer ${login.json().accessToken}` }
      const habitId = (await client.query("INSERT INTO habits (user_id, label, start_date) VALUES ($1, 'Прогулка', '2026-01-03') RETURNING id", [login.json().user.id])).rows[0].id
      const url = '/sleep-records/2026-01-03'
      mark = app
        .inject({
          method: 'PATCH',
          url: `${url}/habits/${habitId}`,
          headers,
          payload: { value: true },
        })
        .then((response) => assert.equal(response.statusCode, 200))
      await waitForBlockedRequest(client)
      const saved = await app.inject({
        method: 'PUT',
        url,
        headers,
        payload: { bedtime: null, wakeTime: '2026-01-03 07:30', napDuration: null },
      })
      assert.equal(saved.statusCode, 200)
      await client.query('SELECT pg_advisory_unlock(hashtext(current_schema()), 1)')
      await mark
      const entry = await app.inject({ method: 'GET', url, headers })
      assert.equal(entry.statusCode, 200)
      assert.equal(entry.json().sleep.wakeTime, '2026-01-03 07:30')
      assert.deepEqual(entry.json().habits, [{ key: habitId, value: true }])
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext(current_schema()), 1)')
        await mark
      } finally {
        await app.close()
      }
    }
  })
})

test('PostgreSQL fixtures refuse an earlier schema without applying migrations or records', async (t) => {
  await withDatabase(t, async (client, connectionString) => {
    await runMigrations({ connectionString, migrationsDir, to: '005' })
    const before = (await client.query('SELECT * FROM schema_migrations ORDER BY id'))
      .rows
    await assert.rejects(
      seedDevFixtures({ connectionString, migrationsDir, date, password }),
      /schema 009/
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

test('removing a habit mark preserves sleep committed while removal is pending', async (t) => {
  await withDatabase(t, async (client, connectionString) => {
    await runMigrations({ connectionString, migrationsDir })
    await seedDevFixtures({ connectionString, migrationsDir, date, password })
    const app = await authApp(connectionString)
    let removal: Promise<unknown> | undefined
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'empty@example.test', password },
      })
      assert.equal(login.statusCode, 200)
      const headers = { authorization: `Bearer ${login.json().accessToken}` }
      const habitId = (await client.query("INSERT INTO habits (user_id, label, start_date) VALUES ($1, 'Прогулка', '2026-01-03') RETURNING id", [login.json().user.id])).rows[0].id
      const url = '/sleep-records/2026-01-03'
      const marked = await app.inject({
        method: 'PATCH',
        url: `${url}/habits/${habitId}`,
        headers,
        payload: { value: true },
      })
      assert.equal(marked.statusCode, 200)
      await client.query('BEGIN')
      await client.query(
        "SELECT habit_id FROM habit_marks WHERE date='2026-01-03' FOR UPDATE"
      )
      removal = app
        .inject({ method: 'DELETE', url: `${url}/habits/${habitId}`, headers })
        .then((response) => assert.equal(response.statusCode, 200))
      await waitForBlockedRequest(client)
      await client.query(`INSERT INTO sleep_records (user_id, date, wake_time) SELECT user_id, date::date, '2026-01-03 07:45'::timestamp FROM daily_entries WHERE date='2026-01-03'`)
      await client.query('COMMIT')
      await removal
      const entry = await app.inject({ method: 'GET', url, headers })
      assert.equal(entry.statusCode, 200)
      assert.equal(entry.json().sleep.wakeTime, '2026-01-03 07:45')
      assert.deepEqual(entry.json().habits, [])
    } finally {
      try {
        await client.query('ROLLBACK')
        await removal
      } finally {
        await app.close()
      }
    }
  })
})


test('permanent deletion serializes with marks and never touches another UUID with the same label', async (t) => {
  await withDatabase(t, async (client, connectionString) => {
    await runMigrations({ connectionString, migrationsDir })
    const app = await authApp(connectionString)
    try {
      const registered = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'delete@example.test', password } })
      const headers = { authorization: `Bearer ${registered.json().accessToken}` }
      const owner = registered.json().user.id
      const create = async () => (await app.inject({ method: 'POST', url: '/habits', headers, payload: { label: 'Книги', creationDate: date } })).json()
      const habit = await create(), replacement = await create()
      assert.notEqual(habit.key, replacement.key)
      const sleepUrl = `/sleep-records/${date}`
      assert.equal((await app.inject({ method: 'PUT', url: sleepUrl, headers, payload: { wakeTime: `${date} 07:00`, napDuration: 15 } })).statusCode, 200)
      await client.query('BEGIN')
      await client.query('SELECT id FROM habits WHERE id=$1 FOR UPDATE', [habit.key])
      const mark = app.inject({ method: 'PATCH', url: `${sleepUrl}/habits/${habit.key}`, headers, payload: { value: true } }).then(r => r)
      await waitForBlockedRequest(client)
      await client.query('DELETE FROM habits WHERE user_id=$1 AND id=$2', [owner, habit.key])
      await client.query('COMMIT')
      assert.equal((await mark).statusCode, 404)
      assert.equal((await client.query('SELECT count(*)::int AS n FROM habit_marks')).rows[0].n, 0)
      await client.query('BEGIN')
      await client.query('INSERT INTO habit_marks (user_id, date, habit_id, value) VALUES ($1,$2,$3,false)', [owner, date, replacement.key])
      const deletion = app.inject({ method: 'DELETE', url: `/habits/${replacement.key}`, headers }).then(r => r)
      await waitForBlockedRequest(client)
      await client.query('COMMIT')
      assert.equal((await deletion).statusCode, 204)
      assert.equal((await client.query('SELECT count(*)::int AS n FROM habit_marks')).rows[0].n, 0)
      const entry = (await app.inject({ url: sleepUrl, headers })).json()
      assert.equal(entry.sleep.wakeTime, `${date} 07:00`)
      assert.equal(entry.sleep.napDuration, 15)
      assert.deepEqual(entry.habits, [])
    } finally {
      await client.query('ROLLBACK')
      await app.close()
    }
  })
})

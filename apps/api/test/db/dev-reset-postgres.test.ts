import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { Client, type QueryResult } from 'pg'
import { loadConfiguration, type Configuration } from '../../src/config/environment'
import { loadMigrationTestConfiguration } from '../../src/db/dev-database'
import { resetDevelopmentDatabase } from '../../src/db/dev-reset'
import {
  reseedDevFixtures,
  seedDevFixtures,
  verifyDevFixtures,
} from '../../src/db/dev-fixtures'
import { getMigrationStatus, runMigrations } from '../../src/db/migrate'
import { prepareFixtureSource } from '../../src/db/git-fixture-source'

const repoRoot = join(__dirname, '../../../..')
const migrationsDir = join(__dirname, '../../src/db/migrations')
const date = '2026-01-02'
const password = 'local-reset-fixture-only'
const request = { sourceRef: 'HEAD', to: '006', date }

async function withClient<T>(
  config: Configuration,
  action: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString: config.MIGRATION_DATABASE_URL })
  try {
    await client.connect()
    return await action(client)
  } finally {
    await client.end()
  }
}

async function checkEmptyPublic(client: Client) {
  const objects = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_depend WHERE refclassid='pg_namespace'::regclass
        AND refobjid='public'::regnamespace
    ) OR EXISTS (
      SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql'
    ) AS occupied
  `)
  assert.equal(
    objects.rows[0].occupied,
    false,
    'Refuse to take over existing public objects or extensions'
  )
}

async function withResetDatabase(
  t: TestContext,
  action: (config: Configuration) => Promise<void>
) {
  if (
    process.env.MIGRATION_DB_TEST !== '1' ||
    process.env.MIGRATION_DB_TEST_TARGET !== 'test'
  ) {
    t.skip(
      'Run pnpm db:test --target test with an independent isolated reset test database'
    )
    return
  }
  const url = process.env.MIGRATION_RESET_TEST_DATABASE_URL
  const targetsPath = process.env.MIGRATION_RESET_TEST_TARGETS_PATH
  assert.ok(
    url && targetsPath,
    'MIGRATION_RESET_TEST_DATABASE_URL and MIGRATION_RESET_TEST_TARGETS_PATH are required'
  )
  const config = loadConfiguration({
    context: 'test',
    targetsPath: resolve(repoRoot, targetsPath),
    env: {
      DB_ENVIRONMENT: 'test',
      DATABASE_URL: url,
      MIGRATION_DATABASE_URL: url,
      JWT_SECRET: 'test',
      JWT_REFRESH_SECRET: 'test',
    },
  })
  config.DEV_FIXTURE_PASSWORD = password
  const primary = loadMigrationTestConfiguration('test')
  assert.notDeepEqual(
    [
      config.databaseTarget.directHost,
      config.databaseTarget.port,
      config.databaseTarget.database,
    ],
    [
      primary.databaseTarget.directHost,
      primary.databaseTarget.port,
      primary.databaseTarget.database,
    ],
    'Public reset scenarios must use a different database from schema-isolated tests'
  )
  await withClient(config, async (client) => {
    await checkEmptyPublic(client)
    assert.equal(
      (await client.query("SELECT to_regnamespace('outside_reset') AS namespace")).rows[0]
        .namespace,
      null
    )
    const role = (
      await client.query(
        'SELECT rolcreatedb, rolsuper FROM pg_roles WHERE rolname=current_user'
      )
    ).rows[0]
    assert.deepEqual(role, { rolcreatedb: false, rolsuper: false })
  })
  try {
    await action(config)
  } finally {
    await withClient(config, async (client) => {
      await client.query('DROP EXTENSION IF EXISTS hstore CASCADE')
      await client.query('DROP SCHEMA IF EXISTS outside_reset CASCADE')
      await client.query(
        'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION CURRENT_USER'
      )
    })
  }
}

const fixtureOptions = (config: Configuration, anchor = date) => ({
  connectionString: config.MIGRATION_DATABASE_URL,
  migrationsDir,
  date: anchor,
  password,
})

async function snapshot(config: Configuration) {
  return withClient(config, async (client) => ({
    users: (await client.query('SELECT * FROM users ORDER BY id')).rows,
    habits: (await client.query('SELECT * FROM habits ORDER BY id')).rows,
    entries: (await client.query('SELECT * FROM daily_entries ORDER BY id')).rows,
    journal: (await client.query('SELECT * FROM schema_migrations ORDER BY id')).rows,
    structure: (
      await client.query(
        "SELECT oid, relname, relkind, relowner, relacl FROM pg_class WHERE relnamespace='public'::regnamespace ORDER BY oid"
      )
    ).rows,
    extensions: (await client.query('SELECT * FROM pg_extension ORDER BY oid')).rows,
  }))
}

test('reset removes experimental public objects in the same database without CREATEDB and recovers after SQL failure', async (t) => {
  await withResetDatabase(t, async (config) => {
    await withClient(config, async (client) => {
      await client.query(
        'CREATE TABLE experiment (value int); INSERT INTO experiment VALUES (42); CREATE SCHEMA outside_reset; CREATE TABLE outside_reset.keep (value int); INSERT INTO outside_reset.keep VALUES (7)'
      )
    })
    const before = await withClient(
      config,
      async (client) =>
        (
          await client.query(
            'SELECT oid FROM pg_database WHERE datname=current_database()'
          )
        ).rows[0].oid
    )
    await assert.rejects(
      resetDevelopmentDatabase(config, { ...request, sourceRef: 'unavailable-source' }),
      /preparation.*preserved/i
    )
    await withClient(config, async (client) => {
      assert.deepEqual((await client.query('SELECT * FROM experiment')).rows, [
        { value: 42 },
      ])
      await assert.rejects(
        resetDevelopmentDatabase(config, request),
        /preparation.*preserved/i
      )
      assert.deepEqual((await client.query('SELECT * FROM experiment')).rows, [
        { value: 42 },
      ])
    })
    const result = await resetDevelopmentDatabase(config, request)
    assert.equal(
      result.commit,
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim()
    )
    assert.equal((await getMigrationStatus(fixtureOptions(config))).applied.at(-1), '006')
    await verifyDevFixtures(fixtureOptions(config))
    await withClient(config, async (client) => {
      assert.equal(
        (
          await client.query(
            'SELECT oid FROM pg_database WHERE datname=current_database()'
          )
        ).rows[0].oid,
        before
      )
      assert.equal(
        (await client.query("SELECT to_regclass('experiment') AS relation")).rows[0]
          .relation,
        null
      )
      assert.deepEqual((await client.query('SELECT * FROM outside_reset.keep')).rows, [
        { value: 7 },
      ])
      assert.equal(
        (
          await client.query(
            "SELECT pg_get_userbyid(nspowner)=current_user AS owns, has_schema_privilege('public','CREATE') AS can_create FROM pg_namespace WHERE nspname='public'"
          )
        ).rows[0].owns,
        true
      )
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM pg_extension WHERE extname='uuid-ossp'"
          )
        ).rows[0].count,
        1
      )
    })
    const prepareBroken = async (input: Parameters<typeof prepareFixtureSource>[0]) => {
      const source = await prepareFixtureSource(input)
      writeFileSync(
        join(source.migrationsDir, '006_set_duration_min_null_for_missing_times.sql'),
        'SELECT missing_reset_test_function();'
      )
      return source
    }
    await assert.rejects(
      resetDevelopmentDatabase(config, request, { prepareSource: prepareBroken }),
      /stage=migrate; version=005/
    )
    await resetDevelopmentDatabase(config, request)
    await verifyDevFixtures(fixtureOptions(config))
  })
})

test('reset refuses unsupported extensions and transitive external view or foreign-key dependencies before cleanup', async (t) => {
  await withResetDatabase(t, async (config) => {
    await withClient(config, async (client) => {
      await client.query(
        'CREATE TABLE experiment (value int PRIMARY KEY); INSERT INTO experiment VALUES (42); CREATE VIEW experiment_view AS SELECT * FROM experiment; CREATE SCHEMA outside_reset'
      )
    })
    for (const [setup, cleanup] of [
      ['CREATE EXTENSION hstore SCHEMA public', 'DROP EXTENSION hstore'],
      [
        'CREATE VIEW outside_reset.dependent AS SELECT * FROM public.experiment_view',
        'DROP VIEW outside_reset.dependent',
      ],
      [
        'CREATE TABLE outside_reset.dependent (value int REFERENCES public.experiment(value))',
        'DROP TABLE outside_reset.dependent',
      ],
      [
        'CREATE TABLE outside_reset.parent (value int PRIMARY KEY); CREATE TABLE public.dependent (value int REFERENCES outside_reset.parent(value))',
        'DROP TABLE public.dependent; DROP TABLE outside_reset.parent',
      ],
      [
        'CREATE TABLE outside_reset.parent (value int); CREATE VIEW public.dependent AS SELECT * FROM outside_reset.parent',
        'DROP VIEW public.dependent; DROP TABLE outside_reset.parent',
      ],
      [
        'CREATE EXTENSION "uuid-ossp"; CREATE FUNCTION outside_reset.member() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; ALTER EXTENSION "uuid-ossp" ADD FUNCTION outside_reset.member()',
        'DROP EXTENSION "uuid-ossp" CASCADE',
      ],
    ]) {
      await withClient(config, async (client) => {
        await client.query(setup)
      })
      await assert.rejects(
        resetDevelopmentDatabase(config, request),
        /preparation.*preserved/i
      )
      await withClient(config, async (client) => {
        assert.deepEqual((await client.query('SELECT * FROM experiment')).rows, [
          { value: 42 },
        ])
        assert.equal(
          (await client.query("SELECT to_regclass('experiment_view') AS relation"))
            .rows[0].relation,
          'experiment_view'
        )
        await client.query(cleanup)
      })
    }
  })
})

test('reseed replaces the dataset and preserves structure and the complete migration journal', async (t) => {
  await withResetDatabase(t, async (config) => {
    await runMigrations(fixtureOptions(config))
    await seedDevFixtures(fixtureOptions(config))
    await withClient(config, async (client) => {
      await client.query(
        "UPDATE users SET email='changed@example.test' WHERE email='empty@example.test'"
      )
    })
    const before = await snapshot(config)
    await reseedDevFixtures(fixtureOptions(config, '2026-02-03'))
    await verifyDevFixtures(fixtureOptions(config, '2026-02-03'))
    const after = await snapshot(config)
    assert.deepEqual(after.journal, before.journal)
    assert.deepEqual(after.structure, before.structure)
    assert.deepEqual(after.extensions, before.extensions)
    assert.equal(after.users.length, 3)
    assert.ok(after.users.some((user) => user.email === 'empty@example.test'))
    assert.equal(after.entries.at(-1)!.date, '2026-02-03')
  })
})

test('reseed refuses other sessions and unsupported trigger side effects before cleanup', async (t) => {
  await withResetDatabase(t, async (config) => {
    await runMigrations(fixtureOptions(config))
    await seedDevFixtures(fixtureOptions(config))
    const before = await snapshot(config)
    await withClient(config, async () => {
      await assert.rejects(
        reseedDevFixtures(fixtureOptions(config)),
        /stopped application sessions/
      )
    })
    assert.deepEqual(await snapshot(config), before)
    await withClient(config, async (client) => {
      await client.query(
        'CREATE SCHEMA outside_reset; CREATE TABLE outside_reset.keep (value int); INSERT INTO outside_reset.keep VALUES (7)'
      )
    })
    for (const body of [
      "UPDATE schema_migrations SET recorded_at = recorded_at + interval '1 day';",
      'UPDATE outside_reset.keep SET value=99;',
    ]) {
      await withClient(config, async (client) => {
        await client.query(
          `CREATE FUNCTION affect_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} RETURN NULL; END $$`
        )
        await client.query(
          'CREATE TRIGGER affect_fixture AFTER TRUNCATE ON users FOR EACH STATEMENT EXECUTE FUNCTION affect_fixture()'
        )
      })
      const withTrigger = await snapshot(config)
      await assert.rejects(
        reseedDevFixtures(fixtureOptions(config)),
        /unsupported.*dependencies/i
      )
      assert.deepEqual(await snapshot(config), withTrigger)
      await withClient(config, async (client) => {
        assert.deepEqual((await client.query('SELECT * FROM outside_reset.keep')).rows, [
          { value: 7 },
        ])
        await client.query(
          'DROP TRIGGER affect_fixture ON users; DROP FUNCTION affect_fixture()'
        )
      })
    }
    await withClient(config, async (client) => {
      await client.query(
        `CREATE FUNCTION outside_reset.affect_fixture() RETURNS timestamp LANGUAGE plpgsql AS $$ BEGIN UPDATE outside_reset.keep SET value=99; RETURN NOW(); END $$`
      )
      await client.query(
        'ALTER TABLE users ALTER COLUMN created_at SET DEFAULT outside_reset.affect_fixture()'
      )
    })
    const withDefault = await snapshot(config)
    await assert.rejects(
      reseedDevFixtures(fixtureOptions(config)),
      /unsupported.*dependencies/i
    )
    assert.deepEqual(await snapshot(config), withDefault)
    await withClient(config, async (client) => {
      assert.deepEqual((await client.query('SELECT * FROM outside_reset.keep')).rows, [
        { value: 7 },
      ])
    })
  })
})

test('reseed refuses sequence defaults before advancing any sequence', async (t) => {
  await withResetDatabase(t, async (config) => {
    await runMigrations(fixtureOptions(config))
    await seedDevFixtures(fixtureOptions(config))
    await withClient(config, async (client) => {
      await client.query(
        'CREATE SCHEMA outside_reset; CREATE SEQUENCE outside_reset.counter; CREATE SEQUENCE public.counter'
      )
    })
    for (const expression of [
      "to_timestamp(nextval('outside_reset.counter'))",
      "to_timestamp(nextval('public.counter'))",
      "to_timestamp(nextval(('outside_reset.' || 'counter')::text::regclass))",
    ]) {
      await withClient(config, async (client) => {
        await client.query(
          `ALTER TABLE users ALTER COLUMN created_at SET DEFAULT ${expression}`
        )
      })
      const before = await snapshot(config)
      await assert.rejects(
        reseedDevFixtures(fixtureOptions(config)),
        /unsupported.*dependencies/i
      )
      assert.deepEqual(await snapshot(config), before)
      await withClient(config, async (client) => {
        for (const sequence of ['outside_reset.counter', 'public.counter'])
          assert.equal(
            (await client.query(`SELECT is_called FROM ${sequence}`)).rows[0].is_called,
            false
          )
      })
    }
  })
})

test('reseed preserves all previous records on cleanup, insertion or verification failure and refuses unknown tables', async (t) => {
  await withResetDatabase(t, async (config) => {
    await runMigrations(fixtureOptions(config))
    await seedDevFixtures(fixtureOptions(config))
    for (const phase of ['clear', 'insert', 'verify', 'journal']) {
      const before = await snapshot(config)
      const originalQuery = Client.prototype.query as (
        this: Client,
        sql: string,
        values?: unknown[]
      ) => Promise<QueryResult<Record<string, unknown>>>
      let injected = false
      let inserts = 0
      // Keep the real connection/transaction; inject only a driver error or bad read
      // after TRUNCATE and writes, without adding unsupported database behavior.
      const query = t.mock.method(
        Client.prototype,
        'query',
        async function (this: Client, sql: string, values?: unknown[]) {
          if (
            sql.startsWith('INSERT INTO users') &&
            phase === 'insert' &&
            ++inserts === 2
          ) {
            injected = true
            throw new Error('private fixture diagnostic')
          }
          const result = await originalQuery.call(this, sql, values)
          if (sql.startsWith('TRUNCATE') && phase === 'clear') {
            injected = true
            throw new Error('private fixture diagnostic')
          }
          if (sql.startsWith('SELECT id, email') && phase === 'journal') {
            injected = true
            await originalQuery.call(
              this,
              "UPDATE schema_migrations SET recorded_at=recorded_at + interval '1 day'"
            )
          }
          if (sql.startsWith('SELECT id, email') && phase === 'verify') {
            injected = true
            return {
              ...result,
              rows: result.rows.map((row) => ({
                ...row,
                email: 'corrupted@example.test',
              })),
            }
          }
          return result
        }
      )
      try {
        await assert.rejects(
          reseedDevFixtures(fixtureOptions(config, '2026-02-03')),
          (error: Error) => {
            assert.match(error.message, /previous records preserved/)
            assert.doesNotMatch(
              error.message,
              /private fixture diagnostic|postgres:|local-reset/
            )
            return true
          }
        )
        assert.equal(injected, true)
      } finally {
        query.mock.restore()
      }
      assert.deepEqual(await snapshot(config), before)
    }
    await withClient(config, async (client) => {
      await client.query(
        'CREATE TABLE experiment (value int); INSERT INTO experiment VALUES (42)'
      )
    })
    const before = await snapshot(config)
    await assert.rejects(
      reseedDevFixtures(fixtureOptions(config)),
      /known application tables/
    )
    assert.deepEqual(await snapshot(config), before)
    await withClient(config, async (client) => {
      assert.deepEqual((await client.query('SELECT * FROM experiment')).rows, [
        { value: 42 },
      ])
    })
  })
})

test('reset test harness refuses existing functions and types as well as relations', async (t) => {
  await withResetDatabase(t, async (config) => {
    await withClient(config, async (client) => {
      for (const [setup, probe, cleanup] of [
        [
          'CREATE FUNCTION keep() RETURNS int LANGUAGE sql AS $$ SELECT 7 $$',
          'SELECT keep() AS value',
          'DROP FUNCTION keep()',
        ],
        [
          "CREATE TYPE keep AS ENUM ('preserved')",
          "SELECT 'preserved'::keep::text AS value",
          'DROP TYPE keep',
        ],
      ]) {
        await client.query(setup)
        const before = (await client.query(probe)).rows
        await assert.rejects(checkEmptyPublic(client), /Refuse to take over/)
        assert.deepEqual((await client.query(probe)).rows, before)
        await client.query(cleanup)
      }
    })
  })
})

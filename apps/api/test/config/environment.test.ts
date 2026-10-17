import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfiguration } from '../../src/config/environment'

test('test configuration validates an independent target without local secrets', () => {
  const config = loadConfiguration({
    env: {
      DB_ENVIRONMENT: 'test',
      DATABASE_URL: 'postgres://fixture:secret@db.invalid/app',
      MIGRATION_DATABASE_URL: 'postgres://fixture:secret@db.invalid/app',
      JWT_SECRET: 'test-access',
      JWT_REFRESH_SECRET: 'test-refresh',
    },
  })
  const cwd = process.cwd()
  try {
    process.chdir(tmpdir())
    assert.equal(
      loadConfiguration({
        env: {
          DB_ENVIRONMENT: 'test',
          DATABASE_URL: 'postgres://fixture:secret@db.invalid/app',
          MIGRATION_DATABASE_URL: 'postgres://fixture:secret@db.invalid/app',
          JWT_SECRET: 'test',
          JWT_REFRESH_SECRET: 'test',
        },
      }).databaseIdentity.host,
      'db.invalid'
    )
  } finally {
    process.chdir(cwd)
  }
  assert.deepEqual(config.databaseIdentity, {
    environment: 'test',
    host: 'db.invalid',
    database: 'app',
    role: 'fixture',
  })
})

test('rejects malformed, foreign, pooled and SQL-scope overrides without leaking input', () => {
  const env = {
    DB_ENVIRONMENT: 'test',
    DATABASE_URL: 'postgres://fixture:private@db.invalid/app',
    MIGRATION_DATABASE_URL: 'postgres://fixture:private@db.invalid/app',
    JWT_SECRET: 'jwt-private',
    JWT_REFRESH_SECRET: 'refresh-private',
  }
  for (const changes of [
    { DATABASE_URL: 'not-a-url-private' },
    { DATABASE_URL: 'https://fixture:private@db.invalid/app' },
    { DATABASE_URL: 'postgres://fixture:private@foreign.invalid/app' },
    { DATABASE_URL: 'postgres://other:private@db.invalid/app' },
    { DATABASE_URL: 'postgres://fixture:private@db.invalid/other' },
    { DATABASE_URL: 'postgres://fixture:private@db.invalid:5433/app' },
    { MIGRATION_DATABASE_URL: 'postgres://fixture:private@db-pooler.invalid/app' },
    ...[
      'host=foreign.invalid',
      'user=other',
      'database=other',
      'options=-csearch_path=private',
      'sslmode=disable',
      'sslmode=require&sslmode=require',
    ].map((query) => ({
      MIGRATION_DATABASE_URL: `${env.MIGRATION_DATABASE_URL}?${query}`,
    })),
    { MIGRATION_DATABASE_URL: undefined },
    { JWT_SECRET: undefined },
    { DB_ENVIRONMENT: undefined },
    { DB_ENVIRONMENT: 'unknown' },
  ]) {
    assert.throws(
      () => loadConfiguration({ env: { ...env, ...changes } }),
      (error: Error) => {
        assert.doesNotMatch(error.message, /private|postgres:\/\//)
        return true
      }
    )
  }
})

test('fixed local context keeps dev secrets under NODE_ENV=production and refuses production selection', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'sadhana-env-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const localEnvPath = join(directory, '.env.dev.local')
  const targetsPath = join(directory, 'targets.json')
  writeFileSync(
    localEnvPath,
    [
      'DB_ENVIRONMENT=dev',
      'DATABASE_URL=postgres://developer:dev-password@dev-pooler.invalid/development',
      'MIGRATION_DATABASE_URL=postgres://developer:dev-password@dev.invalid/development',
      'JWT_SECRET=dev-access',
      'JWT_REFRESH_SECRET=dev-refresh',
    ].join('\n')
  )
  writeFileSync(
    targetsPath,
    JSON.stringify({
      dev: {
        directHost: 'dev.invalid',
        runtimeHost: 'dev-pooler.invalid',
        port: 5432,
        database: 'development',
        role: 'developer',
      },
    })
  )
  const options = {
    context: 'dev' as const,
    localEnvPath,
    targetsPath,
    env: {
      NODE_ENV: 'production',
      JWT_SECRET: 'inherited-secret',
      DEV_FIXTURE_PASSWORD: 'inherited-fixture-password',
    },
  }
  const config = loadConfiguration(options)
  assert.equal(config.DB_ENVIRONMENT, 'dev')
  assert.equal(config.JWT_SECRET, 'dev-access')
  assert.equal(config.DEV_FIXTURE_PASSWORD, undefined)
  writeFileSync(localEnvPath, '\nDEV_FIXTURE_PASSWORD=local-fixture-password', {
    flag: 'a',
  })
  assert.equal(loadConfiguration(options).DEV_FIXTURE_PASSWORD, 'local-fixture-password')
  assert.equal(config.databaseIdentity.host, 'dev-pooler.invalid')
  assert.throws(
    () => loadConfiguration({ ...options, env: { DB_ENVIRONMENT: 'production' } }),
    /conflicts/
  )
  assert.throws(
    () => loadConfiguration({ ...options, targetsPath: join(directory, 'missing') }),
    /target configuration/
  )
  writeFileSync(
    localEnvPath,
    [
      'DATABASE_URL=postgres://developer:dev-password@dev-pooler.invalid/development',
      'MIGRATION_DATABASE_URL=postgres://developer:dev-password@dev.invalid/development',
      'JWT_REFRESH_SECRET=dev-refresh',
    ].join('\n')
  )
  assert.throws(() => loadConfiguration(options), /Missing configuration: JWT_SECRET/)
  assert.throws(
    () => loadConfiguration({ ...options, localEnvPath: join(directory, 'missing') }),
    /local dev configuration/
  )
  writeFileSync(localEnvPath, 'DB_ENVIRONMENT=production')
  assert.throws(() => loadConfiguration(options), /conflicts/)
})

test('production requires independently configured identifiers even under NODE_ENV=production', () => {
  const env = {
    DB_ENVIRONMENT: 'production',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://owner:secret@prod-pooler.invalid/live',
    MIGRATION_DATABASE_URL: 'postgres://owner:secret@prod.invalid/live',
    JWT_SECRET: 'test-access',
    JWT_REFRESH_SECRET: 'test-refresh',
    DB_EXPECTED_DIRECT_HOST: 'prod.invalid',
    DB_EXPECTED_RUNTIME_HOST: 'prod-pooler.invalid',
    DB_EXPECTED_PORT: '5432',
    DB_EXPECTED_NAME: 'live',
    DB_EXPECTED_ROLE: 'owner',
  }
  assert.equal(loadConfiguration({ env }).DB_ENVIRONMENT, 'production')
  assert.throws(
    () => loadConfiguration({ env: { ...env, DB_EXPECTED_ROLE: undefined } }),
    /Missing configuration/
  )
  assert.throws(
    () => loadConfiguration({ env: { ...env, DB_ENVIRONMENT: undefined } }),
    /explicitly/
  )
})

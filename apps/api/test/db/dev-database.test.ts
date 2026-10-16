import assert from 'node:assert/strict'
import childProcess, { type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Client } from 'pg'
import {
  devDatabaseMain,
  loadMigrationTestConfiguration,
} from '../../src/db/dev-database'

test('database commands explain usage and reject invalid arguments without connecting or exposing secrets', async (t) => {
  const previous = { ...process.env }
  const exitCode = process.exitCode
  t.after(() => {
    process.env = previous
    process.exitCode = exitCode
  })
  const messages: string[] = []
  t.mock.method(console, 'log', (message: string) => messages.push(message))
  t.mock.method(console, 'error', (message: string) => messages.push(message))
  const connect = t.mock.method(Client.prototype, 'connect', async () => {
    throw new Error('Unexpected connection')
  })
  Object.assign(process.env, {
    DB_ENVIRONMENT: 'production',
    MIGRATION_TEST_DATABASE_URL: 'postgres://private:secret@foreign.invalid/live',
  })
  for (const command of ['status', 'migrate', 'test', 'seed']) {
    process.exitCode = 0
    await devDatabaseMain([command, '--help'])
    assert.equal(process.exitCode, 0)
    assert.match(messages.at(-1)!, /Usage: pnpm db:/)
  }
  for (const args of [
    ['status', '--to', '001'],
    ['migrate', '--to', 'latest'],
    ['migrate', '--baseline-confirmed-001-006'],
    ['migrate', '--production'],
    ['test'],
    ['test', '--target', 'production'],
    ['test', '--target', 'dev', '--extra'],
    ['seed'],
    ['seed', '--date', '2026-02-30'],
    ['seed', '--date', '2026-01-02', '--production'],
  ]) {
    process.exitCode = 0
    await devDatabaseMain(args)
    assert.equal(process.exitCode, 1)
  }
  for (const command of ['status', 'migrate', 'seed']) {
    process.exitCode = 0
    await devDatabaseMain(
      command === 'seed' ? [command, '--date', '2026-01-02'] : [command]
    )
    assert.equal(process.exitCode, 1)
    assert.match(messages.at(-1)!, /conflicts with the fixed launch context/)
  }
  assert.equal(connect.mock.callCount(), 0)
  assert.doesNotMatch(messages.join('\n'), /secret|private|postgres:\/\//)
})

test('explicit test target requires an independent configured target and matching direct URL', (t) => {
  const previous = { ...process.env }
  t.after(() => {
    process.env = previous
  })
  delete process.env.DB_ENVIRONMENT
  delete process.env.MIGRATION_TEST_DATABASE_URL
  assert.throws(() => loadMigrationTestConfiguration('test'), /Missing configuration/)
  const dir = mkdtempSync(join(tmpdir(), 'sadhana-db-target-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'targets.json')
  process.env.MIGRATION_TEST_TARGETS_PATH = path
  process.env.MIGRATION_TEST_DATABASE_URL =
    'postgres://fixture:secret@localhost:55432/migration_test'
  writeFileSync(path, '{"test":null}')
  assert.throws(
    () => loadMigrationTestConfiguration('test'),
    /Incomplete database target/
  )
  writeFileSync(
    path,
    JSON.stringify({
      test: {
        directHost: 'localhost',
        runtimeHost: 'localhost',
        port: 55432,
        database: 'migration_test',
        role: 'fixture',
      },
    })
  )
  assert.equal(
    loadMigrationTestConfiguration('test').databaseIdentity.database,
    'migration_test'
  )
  process.env.MIGRATION_TEST_DATABASE_URL += '?options=-csearch_path=public'
  assert.throws(() => loadMigrationTestConfiguration('test'), /Invalid DATABASE_URL/)
  process.env.MIGRATION_TEST_DATABASE_URL =
    'postgres://fixture:secret@foreign.invalid:55432/migration_test'
  assert.throws(() => loadMigrationTestConfiguration('test'), /Invalid DATABASE_URL/)
})

test('database test command reports results and failed scenarios without exposing driver diagnostics', async (t) => {
  const previous = { ...process.env }
  const exitCode = process.exitCode
  const dir = mkdtempSync(join(tmpdir(), 'sadhana-db-report-'))
  t.after(() => {
    process.env = previous
    process.exitCode = exitCode
    rmSync(dir, { recursive: true, force: true })
  })
  const path = join(dir, 'targets.json')
  writeFileSync(
    path,
    JSON.stringify({
      test: {
        directHost: 'localhost',
        runtimeHost: 'localhost',
        port: 55432,
        database: 'migration_test',
        role: 'fixture',
      },
    })
  )
  Object.assign(process.env, {
    DB_ENVIRONMENT: 'test',
    MIGRATION_TEST_TARGETS_PATH: path,
    MIGRATION_TEST_DATABASE_URL:
      'postgres://fixture:private-password@localhost:55432/migration_test',
  })
  const messages: string[] = []
  t.mock.method(console, 'log', (message: string) => messages.push(message))
  t.mock.method(console, 'error', (message: string) => messages.push(message))
  let failed = true
  t.mock.method(childProcess, 'spawn', () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough() })
    queueMicrotask(() => {
      child.stdout.write('TAP version 13\n# SELECT private-row; private-password\n')
      child.stdout.end(
        failed
          ? 'not ok 1 - parallel runs serialize\n  ---\n  error: private-password private-row\n  ...\n# tests 1\n# pass 0\n# fail 1\n'
          : 'ok 1 - parallel runs serialize\n# tests 1\n# pass 1\n# fail 0\n'
      )
      child.emit('exit', failed ? 1 : 0)
      child.emit('close', failed ? 1 : 0)
    })
    return child as unknown as ChildProcess
  })
  for (const failure of [true, false]) {
    failed = failure
    messages.length = 0
    process.exitCode = 0
    await devDatabaseMain(['test', '--target', 'test'])
    assert.equal(process.exitCode, failure ? 1 : 0)
    const output = messages.join('\n')
    assert.match(output, /tests 1/)
    assert.match(
      output,
      failure ? /Failed: parallel runs serialize/ : /PostgreSQL tests passed/
    )
    assert.match(output, failure ? /fail 1/ : /pass 1/)
    assert.doesNotMatch(output, /private-|SELECT|postgres:\/\//)
  }
})

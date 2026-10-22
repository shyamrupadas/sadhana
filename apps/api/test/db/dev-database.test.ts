import assert from 'node:assert/strict'
import childProcess, { type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import nodeTest, { test, type TestsStream } from 'node:test'
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
  for (const command of [
    'status',
    'migrate',
    'test',
    'seed',
    'reset',
    'reseed',
    'rehearse',
  ]) {
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
    ['test', '--target', 'test', '--file', '../private.ts'],
    ['test', '--target', 'test', '--test-name-pattern', '['],
    ['seed'],
    ['seed', '--date', '2026-02-30'],
    ['seed', '--date', '2026-01-02', '--production'],
    ['reseed'],
    ['reseed', '--date', '2026-01-02'],
    ['reseed', '--allow-reset', '--date', '2026-02-30'],
    ['reseed', '--allow-reset', '--date', '2026-01-02', '--to', '006'],
    ['reseed', '--allow-reset', '--allow-reset', '--date', '2026-01-02'],
    ['rehearse'],
    [
      'rehearse',
      '--allow-reset',
      '--source-ref',
      'HEAD',
      '--from',
      '006',
      '--to',
      '006',
      '--date',
      '2026-01-02',
      '--checks',
      'example',
    ],
    [
      'rehearse',
      '--allow-reset',
      '--source-ref',
      'HEAD',
      '--from',
      '006',
      '--to',
      '007',
      '--date',
      '2026-01-02',
      '--checks',
      '../private',
    ],
    ['reset'],
    [
      'reset',
      '--allow-reset',
      '--source-ref',
      'HEAD',
      '--to',
      'latest',
      '--date',
      '2026-01-02',
    ],
    ['reset', '--source-ref', 'HEAD', '--to', '006', '--date', '2026-01-02'],
    [
      'reset',
      '--allow-reset',
      '--source-ref',
      'HEAD',
      '--to',
      '006',
      '--date',
      '2026-02-30',
    ],
  ]) {
    process.exitCode = 0
    await devDatabaseMain(args)
    assert.equal(process.exitCode, 1)
  }
  for (const command of ['status', 'migrate', 'seed', 'reset', 'reseed', 'rehearse']) {
    process.exitCode = 0
    await devDatabaseMain(
      command === 'rehearse'
        ? [
            command,
            '--allow-reset',
            '--source-ref',
            'HEAD',
            '--from',
            '006',
            '--to',
            '007',
            '--date',
            '2026-01-02',
            '--checks',
            'example',
          ]
        : command === 'reseed'
          ? [command, '--date', '2026-01-02', '--allow-reset']
          : command === 'reset'
            ? [
                command,
                '--allow-reset',
                '--source-ref',
                'HEAD',
                '--to',
                '006',
                '--date',
                '2026-01-02',
              ]
            : command === 'seed'
              ? [command, '--date', '2026-01-02']
              : [command]
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

test('database test command reports failure locations/codes and keeps full diagnostics opt-in', async (t) => {
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
  let compileFailed = false
  t.mock.method(childProcess, 'spawn', () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    })
    queueMicrotask(() => {
      child.stdout.end()
      child.stderr.end()
      child.emit('close', compileFailed ? 2 : 0)
    })
    return child as unknown as ChildProcess
  })
  const run = t.mock.method(
    nodeTest,
    'run',
    (options: Parameters<typeof nodeTest.run>[0]) => {
      assert.deepEqual(options?.files, ['test/db/migrate.test.ts'])
      assert.equal(options?.testNamePatterns, 'parallel')
      const stream = new PassThrough({ objectMode: true })
      queueMicrotask(() => {
        stream.emit('test:stdout', { message: 'SELECT private-row; private-password' })
        if (failed)
          stream.emit('test:fail', {
            name: 'parallel runs serialize',
            file: join(__dirname, 'migrate.test.ts'),
            line: 40,
            column: 1,
            details: {
              error: new Error('private-password private-row', {
                cause: Object.assign(new Error('private driver SQL'), {
                  code: '23505',
                  stack: 'Error: private driver SQL\n    at test/db/migrate.test.ts:45:3',
                }),
              }),
            },
          })
        stream.emit('test:summary', {
          file: undefined,
          success: !failed,
          counts: { tests: 1, passed: failed ? 0 : 1, skipped: 0, cancelled: 0, todo: 0 },
        })
        stream.end()
      })
      return stream as unknown as TestsStream
    }
  )
  for (const failure of [true, false]) {
    failed = failure
    messages.length = 0
    process.exitCode = 0
    await devDatabaseMain([
      'test',
      '--target',
      'test',
      '--file',
      'test/db/migrate.test.ts',
      '--test-name-pattern',
      'parallel',
    ])
    assert.equal(process.exitCode, failure ? 1 : 0)
    const output = messages.join('\n')
    assert.match(output, /tests 1/)
    assert.match(
      output,
      failure ? /Failed: parallel runs serialize/ : /PostgreSQL tests passed/
    )
    assert.match(output, failure ? /fail 1/ : /pass 1/)
    assert.doesNotMatch(output, /private-|SELECT|postgres:\/\//)
    if (failure) assert.match(output, /migrate.test.ts:45:3; Error; 23505/)
  }
  failed = true
  messages.length = 0
  await devDatabaseMain([
    'test',
    '--target',
    'test',
    '--file',
    'test/db/migrate.test.ts',
    '--test-name-pattern',
    'parallel',
    '--diagnostics',
  ])
  const logPath = messages
    .find((message) => message.startsWith('Full PostgreSQL diagnostics'))!
    .split(': ')
    .at(-1)!
  try {
    assert.equal(statSync(logPath).mode & 0o777, 0o600)
    assert.match(readFileSync(logPath, 'utf8'), /private-password/)
    assert.doesNotMatch(messages.join('\n'), /private-password|private-row|SELECT/)
  } finally {
    rmSync(dirname(logPath), { recursive: true, force: true })
  }
  assert.equal(run.mock.callCount(), 3)
  compileFailed = true
  messages.length = 0
  await devDatabaseMain(['test', '--target', 'test'])
  assert.equal(run.mock.callCount(), 3)
  assert.match(messages.join('\n'), /Typecheck failed; PostgreSQL tests were not started/)
})

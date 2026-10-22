import assert from 'node:assert/strict'
import childProcess, { type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { dockerDatabaseMain } from '../../src/db/docker-database-tests'

test('Docker check provisions independent targets and cleans up on success, failure and interruption', async (t) => {
  const previous = { ...process.env }
  const previousExit = process.exitCode
  t.after(() => {
    process.env = previous
    process.exitCode = previousExit
  })
  Object.assign(process.env, {
    DB_ENVIRONMENT: 'production',
    DATABASE_URL: 'private-production-url',
    MIGRATION_TEST_DATABASE_URL: 'private-production-url',
    PGOPTIONS: 'private-options',
    NODE_OPTIONS: 'private-options',
  })
  const messages: string[] = []
  const commands: string[][] = []
  const paths: string[] = []
  let mode: 'pass' | 'fail' | 'setup-fail' | 'interrupt' = 'pass'
  let provisionSql = ''
  let spawns = 0
  t.mock.method(console, 'log', (value: string) => messages.push(value))
  t.mock.method(console, 'error', (value: string) => messages.push(value))
  t.mock.method(childProcess, 'execFile', ((
    program: string,
    args: string[],
    _options: object,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    assert.equal(program, 'docker')
    commands.push(args)
    const stdin = new PassThrough()
    stdin.on('data', (chunk: Buffer) => {
      provisionSql += chunk.toString()
    })
    queueMicrotask(() => {
      if (mode === 'setup-fail' && args.includes('psql'))
        callback(new Error('private driver SQL'), '', '')
      else callback(null, args[0] === 'port' ? '127.0.0.1:55432\n' : 'ready', '')
    })
    return Object.assign(new EventEmitter(), { stdin }) as unknown as ChildProcess
  }) as typeof childProcess.execFile)
  t.mock.method(
    childProcess,
    'spawn',
    (_program: string, args: readonly string[], options: childProcess.SpawnOptions) => {
      spawns++
      assert.ok(args.includes('--target') && args.includes('test'))
      const env = options.env!
      assert.equal(env.DB_ENVIRONMENT, 'test')
      assert.equal(env.DATABASE_URL, undefined)
      assert.equal(env.NODE_OPTIONS, undefined)
      assert.equal(env.PGOPTIONS, undefined)
      for (const [prefix, expectedDatabase] of [
        ['MIGRATION_TEST', 'migration_test'],
        ['MIGRATION_RESET_TEST', 'reset_test'],
      ]) {
        const path = env[`${prefix}_TARGETS_PATH`]!
        paths.push(path)
        const target = JSON.parse(readFileSync(path, 'utf8')).test
        assert.deepEqual(target, {
          directHost: '127.0.0.1',
          runtimeHost: '127.0.0.1',
          port: 55432,
          database: expectedDatabase,
          role: 'fixture',
        })
        assert.equal(
          new URL(env[`${prefix}_DATABASE_URL`]!).pathname,
          `/${expectedDatabase}`
        )
      }
      const child = new EventEmitter()
      queueMicrotask(() => {
        if (mode === 'interrupt') {
          process.emit('SIGTERM')
          child.emit('error', new Error('interrupted'))
        } else child.emit('close', mode === 'fail' ? 1 : 0)
      })
      return child as unknown as ChildProcess
    }
  )
  for (const outcome of ['pass', 'fail', 'setup-fail', 'interrupt'] as const) {
    mode = outcome
    commands.length = 0
    messages.length = 0
    process.exitCode = 0
    await dockerDatabaseMain([])
    assert.equal(
      process.exitCode,
      outcome === 'pass' ? 0 : outcome === 'interrupt' ? 143 : 1
    )
    const start = commands.find((args) => args[0] === 'run')!
    const name = start[start.indexOf('--name') + 1]
    assert.match(name, /^sadhana-db-test-/)
    assert.deepEqual(commands.at(-1), ['rm', '--force', name])
    assert.ok(paths.every((path) => !existsSync(path)))
    assert.doesNotMatch(messages.join('\n'), /private-|postgres:\/\//)
  }
  assert.match(provisionSql, /NOCREATEDB NOSUPERUSER/)
  assert.equal(spawns, 3)
})

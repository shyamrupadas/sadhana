import { spawn } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { finished } from 'node:stream/promises'
import { run } from 'node:test'
import { inspect } from 'node:util'
import { ConfigurationError } from '../config/environment'
import { MigrationError } from './migrate'

const apiRoot = join(__dirname, '../..')
const files = [
  'test/db/migrate.test.ts',
  'test/db/dev-fixtures-postgres.test.ts',
  'test/db/dev-reset-postgres.test.ts',
]

export const databaseTestUsage =
  'Usage: pnpm db:test --target <dev|test> [--file <test/db/file.test.ts>] [--test-name-pattern <regexp>] [--diagnostics]'

export type DatabaseTestRequest = {
  target: 'dev' | 'test'
  file?: string
  namePattern?: string
  diagnostics: boolean
}

export function parseDatabaseTestArguments(flags: string[]): DatabaseTestRequest {
  const values = new Map<string, string>()
  let diagnostics = false
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index]
    if (flag === '--diagnostics' && !diagnostics) diagnostics = true
    else if (
      ['--target', '--file', '--test-name-pattern'].includes(flag) &&
      !values.has(flag)
    ) {
      const value = flags[++index]
      if (!value || value.startsWith('--'))
        throw new ConfigurationError(databaseTestUsage)
      values.set(flag, value)
    } else throw new ConfigurationError(databaseTestUsage)
  }
  const target = values.get('--target')
  const file = values.get('--file')
  const namePattern = values.get('--test-name-pattern')
  if ((target !== 'dev' && target !== 'test') || (file && !files.includes(file)))
    throw new ConfigurationError(databaseTestUsage)
  if (target === 'dev' && file === files[2])
    throw new ConfigurationError('Reset/rehearsal tests require --target test')
  if (namePattern) {
    try {
      new RegExp(namePattern)
    } catch {
      throw new ConfigurationError('Invalid PostgreSQL test name pattern')
    }
  }
  return { target, file, namePattern, diagnostics }
}

function failureDetails(error: Error): {
  kind: string
  code?: string
  location?: string
} {
  let cause = error
  for (let depth = 0; depth < 5 && cause.cause instanceof Error; depth++)
    cause = cause.cause
  const kind = ['AssertionError', 'TypeError', 'SyntaxError', 'RangeError'].includes(
    cause.name
  )
    ? cause.name
    : 'Error'
  const rawCode = 'code' in cause ? cause.code : undefined
  const code =
    typeof rawCode === 'string' && /^(?:[0-9A-Z]{5}|ERR_[A-Z_]+|E[A-Z]+)$/.test(rawCode)
      ? rawCode
      : undefined
  const location = cause.stack?.match(/test\/db\/[\w.-]+\.test\.ts:\d+:\d+/)?.[0]
  return { kind, code, location }
}

export async function runDatabaseTests(
  request: DatabaseTestRequest,
  signal?: AbortSignal
): Promise<void> {
  let log: number | undefined
  if (request.diagnostics) {
    const directory = mkdtempSync(join(tmpdir(), 'sadhana-db-diagnostics-'))
    const path = join(directory, 'tests.log')
    log = openSync(path, 'wx', 0o600)
    console.log(`Full PostgreSQL diagnostics (local file): ${path}`)
  }
  const record = (value: unknown) => {
    if (log !== undefined)
      writeSync(log, `${inspect(value, { depth: null, colors: false })}\n`)
  }
  try {
    console.log('Typechecking API and tests before PostgreSQL execution...')
    const checked = await new Promise<boolean>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          require.resolve('typescript/bin/tsc'),
          '-p',
          'test/tsconfig.json',
          '--pretty',
          'false',
        ],
        { cwd: apiRoot, signal, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      for (const output of [child.stdout, child.stderr])
        output.on('data', (chunk: Buffer) => {
          process.stderr.write(chunk)
          record(chunk.toString())
        })
      child.once('error', reject)
      child.once('close', (code) => resolve(code === 0))
    })
    if (!checked)
      throw new MigrationError('Typecheck failed; PostgreSQL tests were not started')
    // Node >=24.15 supports an explicit child environment for programmatic run().
    const options = {
      cwd: apiRoot,
      files: request.file ? [request.file] : files,
      execArgv: ['-r', require.resolve('ts-node/register')],
      env: {
        ...process.env,
        MIGRATION_DB_TEST: '1',
        MIGRATION_DB_TEST_TARGET: request.target,
        TS_NODE_PROJECT: join(apiRoot, 'tsconfig.json'),
      },
      testNamePatterns: request.namePattern,
      signal,
    }
    const tests = run(options)
    let success = false
    let matched = false
    tests.on('test:fail', (data) => {
      record(data)
      const { kind, code, location } = failureDetails(data.details.error)
      const place =
        location ??
        `${relative(apiRoot, data.file ?? apiRoot)}:${data.line ?? 0}:${data.column ?? 0}`
      console.error(
        `Failed: ${data.name.replace(/[\r\n]/g, ' ')} (${place}; ${kind}${code ? `; ${code}` : ''})`
      )
    })
    tests.on('test:stdout', record)
    tests.on('test:stderr', record)
    tests.on('test:diagnostic', record)
    tests.on('test:summary', (data) => {
      if (data.file !== undefined) return
      const { tests, passed, skipped, cancelled, todo } = data.counts
      const failed = tests - passed - skipped - cancelled - todo
      matched = tests > 0
      success = data.success
      console.log(
        `PostgreSQL: tests ${tests}, pass ${passed}, fail ${failed}, cancelled ${cancelled}, skipped ${skipped}`
      )
    })
    tests.resume()
    await finished(tests)
    if (!matched) throw new MigrationError('No PostgreSQL tests matched the selection')
    if (!success) throw new MigrationError('PostgreSQL tests failed')
    console.log('PostgreSQL tests passed; temporary schemas cleaned up')
  } finally {
    if (log !== undefined) closeSync(log)
  }
}

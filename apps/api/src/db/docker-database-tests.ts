import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { ConfigurationError } from '../config/environment'
import { parseDatabaseTestArguments } from './database-tests'

const apiRoot = join(__dirname, '../..')
const usage =
  'Usage: pnpm db:test:docker [--file <test/db/file.test.ts>] [--test-name-pattern <regexp>] [--diagnostics]'

function docker(
  args: string[],
  options: { signal?: AbortSignal; input?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      args,
      {
        signal: options.signal,
        env: options.env,
        timeout: 120_000,
        maxBuffer: 1_000_000,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim()))
    )
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(options.input)
  })
}

export async function dockerDatabaseMain(args = process.argv.slice(2)): Promise<void> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage)
    return
  }
  let directory: string | undefined
  let container: string | undefined
  let started = false
  let stage = 'arguments'
  let interrupted: NodeJS.Signals | undefined
  const controller = new AbortController()
  const interrupt = (signal: NodeJS.Signals) => {
    interrupted = signal
    controller.abort()
  }
  const onInterrupt = () => interrupt('SIGINT')
  const onTerminate = () => interrupt('SIGTERM')
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onTerminate)
  try {
    // Reuse the normal command's argument validation; Docker always selects test.
    parseDatabaseTestArguments(['--target', 'test', ...args])
    stage = 'docker availability'
    await docker(['version', '--format', '{{.Server.Version}}'], {
      signal: controller.signal,
    })
    directory = mkdtempSync(join(tmpdir(), 'sadhana-db-docker-'))
    container = `sadhana-db-test-${randomUUID()}`
    const password = randomUUID().replaceAll('-', '')
    stage = 'container startup'
    console.log('Starting temporary PostgreSQL 16 (two isolated test databases)...')
    await docker(
      [
        'run',
        '--detach',
        '--rm',
        '--name',
        container,
        '--publish',
        '127.0.0.1::5432',
        '--tmpfs',
        '/var/lib/postgresql/data',
        '--env',
        'POSTGRES_USER=fixture_admin',
        '--env',
        'POSTGRES_PASSWORD',
        '--env',
        'POSTGRES_DB=postgres',
        'postgres:16',
      ],
      { signal: controller.signal, env: { ...process.env, POSTGRES_PASSWORD: password } }
    )
    started = true
    stage = 'PostgreSQL readiness'
    const deadline = Date.now() + 30_000
    // The image's temporary initialization server only listens on a Unix socket.
    while (true) {
      try {
        await docker(
          [
            'exec',
            container,
            'pg_isready',
            '-h',
            '127.0.0.1',
            '-U',
            'fixture_admin',
            '-d',
            'postgres',
          ],
          { signal: controller.signal }
        )
        break
      } catch {
        if (controller.signal.aborted || Date.now() >= deadline)
          throw new Error('PostgreSQL is not ready')
        await setTimeout(250, undefined, { signal: controller.signal })
      }
    }
    const binding = await docker(['port', container, '5432/tcp'], {
      signal: controller.signal,
    })
    const port = Number(/^127\.0\.0\.1:(\d+)$/.exec(binding)?.[1])
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Unexpected Docker port')
    stage = 'test database provisioning'
    await docker(
      [
        'exec',
        '-i',
        container,
        'psql',
        '-U',
        'fixture_admin',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      {
        signal: controller.signal,
        input: `CREATE ROLE fixture LOGIN PASSWORD '${password}' NOCREATEDB NOSUPERUSER;\nCREATE DATABASE migration_test OWNER fixture;\nCREATE DATABASE reset_test OWNER fixture;\n`,
      }
    )
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          ![
            'DATABASE_URL',
            'MIGRATION_DATABASE_URL',
            'DB_ENVIRONMENT',
            'NODE_OPTIONS',
          ].includes(key) &&
          !key.startsWith('PG') &&
          !key.startsWith('MIGRATION_') &&
          !key.startsWith('TS_NODE_')
      )
    )
    Object.assign(env, { DB_ENVIRONMENT: 'test', NODE_ENV: 'test' })
    for (const [prefix, database] of [
      ['MIGRATION_TEST', 'migration_test'],
      ['MIGRATION_RESET_TEST', 'reset_test'],
    ]) {
      const path = join(directory, `${database}.json`)
      // The independently declared target is not inferred from a connection URL.
      writeFileSync(
        path,
        JSON.stringify({
          test: {
            directHost: '127.0.0.1',
            runtimeHost: '127.0.0.1',
            port,
            database,
            role: 'fixture',
          },
        }),
        { mode: 0o600 }
      )
      env[`${prefix}_TARGETS_PATH`] = path
      env[`${prefix}_DATABASE_URL`] =
        `postgres://fixture:${password}@127.0.0.1:${port}/${database}`
    }
    stage = 'PostgreSQL tests'
    console.log('Running db:test --target test; development database is unchanged.')
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          require.resolve('tsx'),
          join(__dirname, 'dev-database.ts'),
          'test',
          '--target',
          'test',
          ...args,
        ],
        { cwd: apiRoot, env, signal: controller.signal, stdio: 'inherit' }
      )
      child.once('error', reject)
      child.once('close', (code) => resolve(code ?? 1))
    })
    if (code !== 0) process.exitCode = code
  } catch (error) {
    console.error(
      error instanceof ConfigurationError
        ? error.message
        : `Docker database check failed: ${stage}`
    )
    process.exitCode =
      interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1
  } finally {
    if (container) {
      try {
        await docker(['rm', '--force', container])
        console.log('Temporary PostgreSQL container removed.')
      } catch {
        if (started) {
          console.error(`Could not remove temporary container: ${container}`)
          process.exitCode = 1
        }
      }
    }
    if (directory) rmSync(directory, { recursive: true, force: true })
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onTerminate)
  }
}

if (require.main === module) void dockerDatabaseMain()

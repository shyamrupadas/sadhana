import { execFileSync, spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadMigrations } from './migrate'
import { validateFixtureDate, validateFixturePassword } from './dev-fixtures'

export class SourceError extends Error {}

export type PreparedFixtureSource = {
  commit: string
  generator: string
  directory: string
  migrationsDir: string
  seed(connectionString: string, password: string): Promise<void>
  verify(connectionString: string): Promise<void>
  cleanup(): Promise<void>
}

const apiRoot = join(__dirname, '../..')

// This small source format deliberately supports the saved v1 generator, not arbitrary
// historical applications. No env/config data, install scripts or Git hooks are extracted.
const sourceFiles = [
  'src/db/dev-fixtures.ts',
  'src/db/migrate.ts',
  'src/config/environment.ts',
]
const runner = `
const fs = require('node:fs');
const fixtures = require('./src/db/dev-fixtures.ts');
async function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const { devFixtureVersion: version } = fixtures;
  for (const name of ['buildDevFixtures', 'validateFixtureDate', 'validateFixturePassword', 'seedDevFixtures', 'verifyDevFixtures']) {
    if (typeof fixtures[name] !== 'function') throw new Error('Unsupported fixture interface');
  }
  if (!version || typeof version.generator !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(version.generator) || version.schema !== input.to) throw new Error('Unsupported schema');
  fixtures.validateFixtureDate(input.date);
  const options = { connectionString: input.connectionString, migrationsDir: './src/db/migrations', date: input.date };
  if (input.action === 'prepare') {
    fixtures.validateFixturePassword(input.password);
    fixtures.buildDevFixtures(input.date);
    await require('bcrypt').hash('dependency-check-only', 4);
    process.stdout.write(JSON.stringify({ generator: version.generator }));
  } else if (input.action === 'seed') {
    await fixtures.seedDevFixtures({ ...options, password: input.password });
  } else if (input.action === 'verify') {
    await fixtures.verifyDevFixtures(options);
  } else throw new Error('Unknown source action');
}
main().catch(() => { process.exitCode = 1; });
`

async function runSource(directory: string, input: object): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', require.resolve('tsx'), 'runner.cjs'],
      {
        cwd: directory,
        // Inherited PG*, NODE_OPTIONS, JWTs, dotenv and loader settings must not select a target.
        env: { NODE_ENV: 'test', TZ: 'UTC', TMPDIR: tmpdir() },
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 300_000,
      }
    )
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      if (output.length > 64_000) child.kill()
    })
    child.stdin.on('error', () => undefined)
    child.once('error', () =>
      reject(new SourceError('Historical source execution failed'))
    )
    child.once('close', (code) => {
      if (code === 0) resolve(output)
      else reject(new SourceError('Historical source execution failed'))
    })
    // Credentials travel only over stdin, never command arguments, output or temp files.
    child.stdin.end(JSON.stringify(input))
  })
}

export async function prepareFixtureSource(options: {
  repoRoot: string
  sourceRef: string
  to: string
  date: string
  password: string
}): Promise<PreparedFixtureSource> {
  const directory = mkdtempSync(join(tmpdir(), 'sadhana-db-source-'))
  const cleanup = async () => rmSync(directory, { recursive: true, force: true })
  try {
    validateFixtureDate(options.date)
    validateFixturePassword(options.password)
    if (!/^\d{3}$/.test(options.to)) throw new SourceError()
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', options.repoRoot, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10_000,
        maxBuffer: 16 * 1024 * 1024,
      })
    const commit = git(
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${options.sourceRef}^{commit}`
    ).trim()
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new SourceError()
    const blob = (path: string) => git('show', `${commit}:apps/api/${path}`)
    const historical = JSON.parse(blob('package.json'))
    const current = JSON.parse(readFileSync(join(apiRoot, 'package.json'), 'utf8'))
    // Only the installed, explicitly supported runtime dependency declarations are reused.
    // A dependency change needs a new supported source format, never a silent replacement.
    for (const dependency of ['pg', 'bcrypt', 'dotenv']) {
      if (
        !historical.dependencies?.[dependency] ||
        historical.dependencies[dependency] !== current.dependencies[dependency]
      ) {
        throw new SourceError()
      }
    }
    for (const file of sourceFiles) {
      const path = join(directory, file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, blob(file))
    }
    const migrationsDir = join(directory, 'src/db/migrations')
    mkdirSync(migrationsDir)
    const names = git('ls-tree', '--name-only', `${commit}:apps/api/src/db/migrations`)
      .trim()
      .split('\n')
    for (const name of names.filter((name) => name.endsWith('.sql'))) {
      if (!/^\d{3}_[a-zA-Z0-9_-]+\.sql$/.test(name)) throw new SourceError()
      // Read raw bytes so the migrator's checksum is exactly that of the Git blob.
      const bytes = execFileSync(
        'git',
        ['-C', options.repoRoot, 'show', `${commit}:apps/api/src/db/migrations/${name}`],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 10_000,
          maxBuffer: 16 * 1024 * 1024,
        }
      )
      writeFileSync(join(migrationsDir, name), bytes)
    }
    if (!loadMigrations(migrationsDir).some(({ id }) => id === options.to))
      throw new SourceError()
    writeFileSync(join(directory, 'runner.cjs'), runner)
    symlinkSync(join(apiRoot, 'node_modules'), join(directory, 'node_modules'), 'dir')
    const input = { to: options.to, date: options.date }
    const { generator } = JSON.parse(
      await runSource(directory, {
        ...input,
        action: 'prepare',
        password: options.password,
      })
    )
    if (typeof generator !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(generator))
      throw new SourceError()
    return {
      commit,
      generator,
      directory,
      migrationsDir,
      seed: async (connectionString, password) => {
        await runSource(directory, {
          ...input,
          action: 'seed',
          connectionString,
          password,
        })
      },
      verify: async (connectionString) => {
        await runSource(directory, { ...input, action: 'verify', connectionString })
      },
      cleanup,
    }
  } catch {
    await cleanup()
    throw new SourceError(
      'Git source preparation failed: unavailable commit, SQL, compatible generator or dependencies; database preserved'
    )
  }
}

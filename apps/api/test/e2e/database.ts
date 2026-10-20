import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import bcrypt from 'bcrypt'
import { Client } from 'pg'
import { ConfigurationError, loadConfiguration } from '../../src/config/environment'
import { getMigrationStatus } from '../../src/db/migrate'
import { publicDatabaseUrl } from '../../src/db/dev-schema'

type Account = { email: string; id?: string }
type Manifest = { runId: string; ownerPid: number; target: string; accounts: Account[] }
type Database = { query(sql: string, values: unknown[]): Promise<unknown> }
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const apiRoot = join(__dirname, '..', '..')

class E2eDatabaseError extends Error {}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

// The journal is written before INSERT/registration, so a lost response can be cleaned up.
export class E2eAccounts {
  constructor(
    private directory: string,
    private target: string,
    private database: Database
  ) {}

  private path(runId: string) {
    if (!uuid.test(runId)) throw new E2eDatabaseError('Invalid E2E run identifier')
    return join(this.directory, `${runId}.json`)
  }

  private read(runId: string): Manifest {
    const manifest: Manifest = JSON.parse(readFileSync(this.path(runId), 'utf8'))
    if (
      manifest.runId !== runId ||
      manifest.target !== this.target ||
      !Number.isSafeInteger(manifest.ownerPid) ||
      manifest.ownerPid <= 0 ||
      !Array.isArray(manifest.accounts) ||
      !manifest.accounts.every(
        ({ email, id }) =>
          typeof email === 'string' &&
          email.startsWith(`e2e-${runId}-`) &&
          uuid.test(email.slice(`e2e-${runId}-`.length, -'@example.test'.length)) &&
          email.endsWith('@example.test') &&
          (id === undefined || uuid.test(id))
      )
    )
      throw new E2eDatabaseError(
        'E2E manifest is invalid or belongs to another dev database; inspect it before retrying'
      )
    return manifest
  }

  private write(manifest: Manifest) {
    const path = this.path(manifest.runId)
    writeFileSync(`${path}.tmp`, JSON.stringify(manifest), { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  }

  async start(runId: string, ownerPid: number, ownerAlive = isAlive) {
    this.path(runId)
    if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
      throw new E2eDatabaseError('Invalid E2E owner process')
    }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    for (const file of readdirSync(this.directory).filter((name) =>
      name.endsWith('.json')
    )) {
      const previous = this.read(file.slice(0, -'.json'.length))
      if (!ownerAlive(previous.ownerPid)) await this.finish(previous.runId)
    }
    writeFileSync(
      this.path(runId),
      JSON.stringify({ runId, ownerPid, target: this.target, accounts: [] }),
      { flag: 'wx', mode: 0o600 }
    )
  }

  reserve(runId: string): Account {
    const manifest = this.read(runId)
    const account = { email: `e2e-${runId}-${randomUUID()}@example.test` }
    manifest.accounts.push(account)
    this.write(manifest)
    return account
  }

  async seed(runId: string, email: string, password: string): Promise<Account> {
    const manifest = this.read(runId)
    const account = manifest.accounts.find((item) => item.email === email)
    if (!account || account.id)
      throw new E2eDatabaseError('Account is not reserved for this E2E run')
    if (
      typeof password !== 'string' ||
      password.length < 6 ||
      Buffer.byteLength(password) > 72
    ) {
      throw new E2eDatabaseError('Invalid E2E password')
    }
    account.id = randomUUID()
    this.write(manifest)
    await this.database.query(
      'INSERT INTO public.users (id, email, password_hash) VALUES ($1, $2, $3)',
      [account.id, account.email, await bcrypt.hash(password, 10)]
    )
    return account
  }

  async remove(runId: string, email: string) {
    const manifest = this.read(runId)
    const account = manifest.accounts.find((item) => item.email === email)
    if (!account) throw new E2eDatabaseError('Account is not tracked by this E2E run')
    await this.database.query(
      'DELETE FROM public.users WHERE email = $1 AND ($2::uuid IS NULL OR id = $2)',
      [account.email, account.id ?? null]
    )
    manifest.accounts = manifest.accounts.filter((item) => item.email !== email)
    this.write(manifest)
  }

  async finish(runId: string) {
    const manifest = this.read(runId)
    for (const account of manifest.accounts) await this.remove(runId, account.email)
    rmSync(this.path(runId))
  }
}

async function main(command: string) {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const config = loadConfiguration({ context: 'dev' })
  const connectionString = publicDatabaseUrl(config.MIGRATION_DATABASE_URL)
  if (command === 'prepare') {
    const status = await getMigrationStatus({
      connectionString,
      migrationsDir: join(apiRoot, 'src/db/migrations'),
    })
    if (!status.journalExists || status.pending.length) {
      throw new E2eDatabaseError(
        'Dev schema is not ready. Review pnpm db:status and apply migrations separately with pnpm db:migrate'
      )
    }
  }
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
  })
  try {
    await client.connect()
    const identity = await client.query(
      'SELECT current_database() AS database, current_user AS role'
    )
    if (
      identity.rows[0].database !== config.databaseTarget.database ||
      identity.rows[0].role !== config.databaseTarget.role
    ) {
      throw new E2eDatabaseError(
        'Connected PostgreSQL identity differs from the configured dev target'
      )
    }
    const accounts = new E2eAccounts(
      join(apiRoot, '.e2e.local'),
      JSON.stringify(config.databaseTarget),
      client
    )
    let result: unknown
    switch (command) {
      case 'prepare':
        result = await accounts.start(input.runId, input.ownerPid)
        break
      case 'reserve':
        result = accounts.reserve(input.runId)
        break
      case 'seed':
        result = await accounts.seed(input.runId, input.email, input.password)
        break
      case 'remove':
        result = await accounts.remove(input.runId, input.email)
        break
      case 'finish':
        result = await accounts.finish(input.runId)
        break
      default:
        throw new E2eDatabaseError('Unknown E2E database command')
    }
    process.stdout.write(JSON.stringify(result ?? null))
  } finally {
    await client.end()
  }
}

if (require.main === module && process.argv[2]) {
  void main(process.argv[2]).catch((error) => {
    // SQL/driver errors can contain connection secrets and must not reach Playwright reports.
    console.error(
      error instanceof ConfigurationError || error instanceof E2eDatabaseError
        ? error.message
        : 'E2E database operation failed; verify dev connectivity and schema. Tracked accounts remain available for cleanup on the next run'
    )
    process.exitCode = 1
  })
}

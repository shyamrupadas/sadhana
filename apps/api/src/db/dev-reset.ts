import { join } from 'node:path'
import { Client } from 'pg'
import {
  ConfigurationError,
  validateDatabaseUrls,
  type Configuration,
} from '../config/environment'
import { validateFixtureDate, validateFixturePassword } from './dev-fixtures'
import { prepareFixtureSource, type PreparedFixtureSource } from './git-fixture-source'
import { getMigrationStatus, runMigrations } from './migrate'

export class ResetError extends Error {}

export const resetUsage =
  'Usage: pnpm db:dev-reset --allow-reset --source-ref <git-ref> --to <NNN> --date <YYYY-MM-DD>'

export type ResetRequest = { sourceRef: string; to: string; date: string }

export function parseResetArguments(flags: string[]): ResetRequest {
  const values = new Map<string, string>()
  let allowed = false
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index]
    if (flag === '--allow-reset' && !allowed) {
      allowed = true
    } else if (['--source-ref', '--to', '--date'].includes(flag) && !values.has(flag)) {
      const value = flags[++index]
      if (!value || value.startsWith('--')) throw new ConfigurationError(resetUsage)
      values.set(flag, value)
    } else throw new ConfigurationError(resetUsage)
  }
  if (!allowed || values.size !== 3 || !/^\d{3}$/.test(values.get('--to')!)) {
    throw new ConfigurationError(resetUsage)
  }
  const request = {
    sourceRef: values.get('--source-ref')!,
    to: values.get('--to')!,
    date: values.get('--date')!,
  }
  validateFixtureDate(request.date)
  return request
}

type Maintenance = {
  check(): Promise<void>
  drop(): Promise<void>
  create(): Promise<void>
  close(): Promise<void>
}

export type ResetOperations = {
  prepareSource: typeof prepareFixtureSource
  maintenance(config: Configuration): Maintenance
  migrate: typeof runMigrations
  status: typeof getMigrationStatus
}

function maintenance(config: Configuration): Maintenance {
  const { database, maintenanceDatabase, role } = config.databaseTarget
  const url = new URL(config.MIGRATION_DATABASE_URL)
  url.pathname = `/${maintenanceDatabase!}`
  const client = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 10_000,
  })
  // Identifiers have already passed the independent target validation; quote them as well.
  const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`
  return {
    async check() {
      await client.connect()
      await client.query("SET statement_timeout = '30s'")
      const result = await client.query<{
        can_create: boolean
        owns_database: boolean
        idle: boolean
      }>(
        `
        SELECT (r.rolcreatedb OR r.rolsuper) AS can_create,
          (d.datname IS NULL OR d.datdba = r.oid) AS owns_database,
          NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = $1) AS idle
        FROM pg_roles r LEFT JOIN pg_database d ON d.datname = $1
        WHERE r.rolname = current_user AND current_database() = $2 AND current_user = $3
      `,
        [database, maintenanceDatabase, role]
      )
      const rights = result.rows[0]
      if (!rights?.can_create || !rights.owns_database || !rights.idle) {
        throw new ResetError(
          'Maintenance permissions or stopped application connections required'
        )
      }
    },
    async drop() {
      await client.query(`DROP DATABASE IF EXISTS ${quote(database)}`)
    },
    async create() {
      await client.query(
        `CREATE DATABASE ${quote(database)} OWNER ${quote(role)} TEMPLATE template0`
      )
    },
    async close() {
      await client.end()
    },
  }
}

const defaultOperations: ResetOperations = {
  prepareSource: prepareFixtureSource,
  maintenance,
  migrate: runMigrations,
  status: getMigrationStatus,
}

export async function resetDevelopmentDatabase(
  config: Configuration,
  request: ResetRequest,
  operations: Partial<ResetOperations> = {}
): Promise<{ commit: string; generator: string; schema: string; date: string }> {
  const actions = { ...defaultOperations, ...operations }
  let source: PreparedFixtureSource | undefined
  let service: Maintenance | undefined
  let stage = 'preparation'
  try {
    if (!['dev', 'test'].includes(config.DB_ENVIRONMENT))
      throw new ConfigurationError('Reset requires dev context')
    validateDatabaseUrls(config)
    const { database, role, maintenanceDatabase } = config.databaseTarget
    if (
      !maintenanceDatabase ||
      maintenanceDatabase === database ||
      ['postgres', 'template0', 'template1'].includes(database) ||
      ![database, role, maintenanceDatabase].every(
        (name) => /^[a-zA-Z0-9_.-]+$/.test(name) && Buffer.byteLength(name) <= 63
      )
    )
      throw new ConfigurationError(
        'Reset requires a distinct allowed maintenance database'
      )
    validateFixtureDate(request.date)
    validateFixturePassword(config.DEV_FIXTURE_PASSWORD)
    source = await actions.prepareSource({
      ...request,
      password: config.DEV_FIXTURE_PASSWORD,
      repoRoot: join(__dirname, '../../../..'),
    })
    service = actions.maintenance(config)
    await service.check()
    const options = {
      connectionString: config.MIGRATION_DATABASE_URL,
      migrationsDir: source.migrationsDir,
    }
    stage = 'drop'
    await service.drop()
    stage = 'create'
    await service.create()
    stage = 'migrate'
    await actions.migrate({ ...options, to: request.to })
    stage = 'seed'
    await source.seed(options.connectionString, config.DEV_FIXTURE_PASSWORD)
    stage = 'verify'
    await source.verify(options.connectionString)
    return {
      commit: source.commit,
      generator: source.generator,
      schema: request.to,
      date: request.date,
    }
  } catch {
    if (stage === 'preparation') {
      throw new ResetError(
        'Reset preparation failed; existing database preserved (check source, target, dependencies, maintenance permissions and stopped application connections)'
      )
    }
    let state = 'database unavailable or history unreadable'
    if (source) {
      try {
        const status = await actions.status({
          connectionString: config.MIGRATION_DATABASE_URL,
          migrationsDir: source.migrationsDir,
        })
        state = `version=${status.applied.at(-1) ?? 'empty'}`
      } catch {
        /* The database may have been dropped, or the connection may be unavailable. */
      }
    }
    throw new ResetError(
      `Reset failed: stage=${stage}; ${state}; previous state is not restored; rerun an explicit reset`
    )
  } finally {
    try {
      await service?.close()
    } catch {
      /* No driver diagnostics in command output. */
    }
    await source?.cleanup()
  }
}

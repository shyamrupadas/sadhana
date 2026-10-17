import { join } from 'node:path'
import {
  ConfigurationError,
  validateDatabaseUrls,
  type Configuration,
} from '../config/environment'
import { validateFixtureDate, validateFixturePassword } from './dev-fixtures'
import { prepareFixtureSource, type PreparedFixtureSource } from './git-fixture-source'
import { getMigrationStatus, runMigrations } from './migrate'
import {
  openPublicSchema,
  publicDatabaseUrl,
  type PublicSchemaSession,
} from './dev-schema'

export class ResetError extends Error {}

export const resetUsage =
  'Usage: pnpm db:dev-reset --allow-reset --source-ref <git-ref> --to <NNN> --date <YYYY-MM-DD>'

export type ResetRequest = { sourceRef: string; to: string; date: string }

export const reseedUsage = 'Usage: pnpm db:dev-reseed --allow-reset --date <YYYY-MM-DD>'

export function parseReseedArguments(flags: string[]): string {
  const dateFlags = flags.filter((flag) => flag !== '--allow-reset')
  if (flags.length !== 3 || dateFlags.length !== 2 || dateFlags[0] !== '--date') {
    throw new ConfigurationError(reseedUsage)
  }
  validateFixtureDate(dateFlags[1])
  return dateFlags[1]
}

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

export type ResetOperations = {
  prepareSource: typeof prepareFixtureSource
  structure(config: Configuration): PublicSchemaSession
  migrate: typeof runMigrations
  status: typeof getMigrationStatus
}

const defaultOperations: ResetOperations = {
  prepareSource: prepareFixtureSource,
  structure: openPublicSchema,
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
  let structure: PublicSchemaSession | undefined
  let stage = 'preparation'
  try {
    if (!['dev', 'test'].includes(config.DB_ENVIRONMENT))
      throw new ConfigurationError('Reset requires dev context')
    validateDatabaseUrls(config)
    const { database, role } = config.databaseTarget
    if (
      ['postgres', 'template0', 'template1'].includes(database) ||
      ![database, role].every(
        (name) => /^[a-zA-Z0-9_.-]+$/.test(name) && Buffer.byteLength(name) <= 63
      )
    )
      throw new ConfigurationError(
        'Reset requires the configured application database and role'
      )
    validateFixtureDate(request.date)
    validateFixturePassword(config.DEV_FIXTURE_PASSWORD)
    source = await actions.prepareSource({
      ...request,
      password: config.DEV_FIXTURE_PASSWORD,
      repoRoot: join(__dirname, '../../../..'),
    })
    structure = actions.structure(config)
    await structure.check()
    const options = {
      connectionString: publicDatabaseUrl(config.MIGRATION_DATABASE_URL),
      migrationsDir: source.migrationsDir,
    }
    stage = 'clear'
    await structure.reset()
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
        'Reset preparation failed; existing database preserved (check source, target, dependencies, public schema permissions and stopped application connections)'
      )
    }
    let state = 'public schema state unreadable'
    if (source) {
      try {
        const status = await actions.status({
          connectionString: publicDatabaseUrl(config.MIGRATION_DATABASE_URL),
          migrationsDir: source.migrationsDir,
        })
        state = `version=${status.applied.at(-1) ?? 'empty'}`
      } catch {
        /* Do not infer that the database was removed from an unreadable connection/history. */
      }
    }
    throw new ResetError(
      `Reset failed: stage=${stage}; ${state}; previous state is not restored; rerun an explicit reset`
    )
  } finally {
    try {
      await structure?.close()
    } catch {
      /* No driver diagnostics in command output. */
    }
    await source?.cleanup()
  }
}

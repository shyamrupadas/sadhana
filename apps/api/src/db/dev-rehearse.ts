import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { ConfigurationError, type Configuration } from '../config/environment'
import {
  resetDevelopmentDatabase,
  validateResetConfiguration,
  type ResetOperations,
} from './dev-reset'
import { prepareFixtureSource, type PreparedFixtureSource } from './git-fixture-source'
import { prepareRehearsalTarget, type PreparedRehearsalTarget } from './rehearsal-checks'
import { getMigrationStatus, runMigrations } from './migrate'
import { openPublicSchema, publicDatabaseUrl } from './dev-schema'
import { validateFixtureDate } from './dev-fixtures'

export const rehearsalUsage =
  'Usage: pnpm db:rehearse --allow-reset --source-ref <git-ref> --from <NNN> --to <NNN> --date <YYYY-MM-DD> --checks <name>'

export type RehearsalRequest = {
  sourceRef: string
  from: string
  to: string
  date: string
  checks: string
}

export function parseRehearsalArguments(flags: string[]): RehearsalRequest {
  const values = new Map<string, string>()
  let allowed = false
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index]
    if (flag === '--allow-reset' && !allowed) allowed = true
    else if (
      ['--source-ref', '--from', '--to', '--date', '--checks'].includes(flag) &&
      !values.has(flag)
    ) {
      const value = flags[++index]
      if (!value || value.startsWith('--')) throw new ConfigurationError(rehearsalUsage)
      values.set(flag, value)
    } else throw new ConfigurationError(rehearsalUsage)
  }
  const request = {
    sourceRef: values.get('--source-ref')!,
    from: values.get('--from')!,
    to: values.get('--to')!,
    date: values.get('--date')!,
    checks: values.get('--checks')!,
  }
  if (
    !allowed ||
    values.size !== 5 ||
    !/^\d{3}$/.test(request.from) ||
    !/^\d{3}$/.test(request.to) ||
    request.to <= request.from ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(request.checks)
  )
    throw new ConfigurationError(rehearsalUsage)
  validateFixtureDate(request.date)
  return request
}

export class RehearsalError extends Error {}

type RehearsalOperations = ResetOperations & {
  prepareTarget: typeof prepareRehearsalTarget
}

export async function rehearseDevelopmentDatabase(
  config: Configuration,
  request: RehearsalRequest,
  operations: Partial<RehearsalOperations> = {}
) {
  const actions: RehearsalOperations = {
    prepareSource: prepareFixtureSource,
    prepareTarget: prepareRehearsalTarget,
    structure: openPublicSchema,
    migrate: runMigrations,
    status: getMigrationStatus,
    ...operations,
  }
  let source: PreparedFixtureSource | undefined
  let target: PreparedRehearsalTarget | undefined
  let stage = 'preparation'
  const results: string[] = []
  try {
    const password = validateResetConfiguration(config, request.date)
    if (
      !/^\d{3}$/.test(request.from) ||
      !/^\d{3}$/.test(request.to) ||
      request.to <= request.from ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(request.checks)
    )
      throw new Error('Invalid rehearsal request')
    source = await actions.prepareSource({
      repoRoot: join(__dirname, '../../../..'),
      sourceRef: request.sourceRef,
      to: request.from,
      date: request.date,
      password,
    })
    target = await actions.prepareTarget({
      sourceMigrationsDir: source.migrationsDir,
      from: request.from,
      to: request.to,
      checks: request.checks,
    })
    const connectionString = publicDatabaseUrl(config.MIGRATION_DATABASE_URL)
    const options = {
      connectionString,
      migrationsDir: target.migrationsDir,
      to: request.to,
    }
    // Reset borrows the already prepared source. This scope owns it until all stages finish.
    const prepared = source
    await resetDevelopmentDatabase(
      config,
      { sourceRef: request.sourceRef, to: request.from, date: request.date },
      {
        ...actions,
        prepareSource: async () => ({
          ...prepared,
          cleanup: async () => undefined,
          seed: async (...args) => {
            stage = 'seed'
            await prepared.seed(...args)
          },
          verify: async (...args) => {
            stage = 'verify-source'
            await prepared.verify(...args)
          },
        }),
        structure: (configuration) => {
          const session = actions.structure(configuration)
          return {
            ...session,
            reset: async () => {
              stage = 'clear'
              await session.reset()
            },
          }
        },
        migrate: async (input) => {
          stage = 'restore-migrate'
          await actions.migrate(input)
        },
      }
    )
    results.push('restore')
    stage = 'source'
    await target.check('source', connectionString, request.date)
    results.push(stage)
    stage = 'migrate'
    await actions.migrate(options)
    results.push(stage)
    for (const phase of ['schema', 'data', 'preservation'] as const) {
      stage = phase
      await target.check(phase, connectionString, request.date)
      results.push(phase)
    }
    stage = 'snapshot'
    const before = await target.snapshot(connectionString)
    stage = 'repeat'
    await actions.migrate(options)
    const after = await target.snapshot(connectionString)
    if (!isDeepStrictEqual(after, before))
      throw new Error('Repeat changed data or migration journal')
    results.push(stage)
    return {
      commit: source.commit,
      generator: source.generator,
      from: request.from,
      to: request.to,
      date: request.date,
      checks: request.checks,
      results,
    }
  } catch {
    if (stage === 'preparation')
      throw new RehearsalError(
        'Rehearsal preparation failed; existing database preserved (check target, Git source, SQL prefix/scope, complete checks and public schema permissions)'
      )
    let state = 'public schema state unreadable'
    try {
      const status = await actions.status({
        connectionString: publicDatabaseUrl(config.MIGRATION_DATABASE_URL),
        migrationsDir: target!.migrationsDir,
      })
      state = `version=${status.applied.at(-1) ?? 'empty'}`
    } catch {
      /* Never infer database removal from an unreadable connection/history. */
    }
    throw new RehearsalError(
      `Rehearsal failed: stage=${stage}; ${state}; previous state is not restored; rerun the full rehearsal`
    )
  } finally {
    try {
      await target?.cleanup()
    } finally {
      await source?.cleanup()
    }
  }
}

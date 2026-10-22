import { join, resolve } from 'node:path'
import { ConfigurationError, loadConfiguration } from '../config/environment'
import { getMigrationStatus, MigrationError, runMigrations } from './migrate'
import {
  parseResetArguments,
  ResetError,
  resetDevelopmentDatabase,
  resetUsage,
  parseReseedArguments,
  reseedUsage,
} from './dev-reset'
import { publicDatabaseUrl } from './dev-schema'
import {
  databaseTestUsage,
  parseDatabaseTestArguments,
  runDatabaseTests,
} from './database-tests'
import {
  parseRehearsalArguments,
  rehearsalUsage,
  rehearseDevelopmentDatabase,
  RehearsalError,
} from './dev-rehearse'
import {
  devFixtureVersion,
  FixtureError,
  seedDevFixtures,
  reseedDevFixtures,
  validateFixtureDate,
  validateFixturePassword,
} from './dev-fixtures'

const apiRoot = join(__dirname, '..', '..')

export function loadMigrationTestConfiguration(target: 'dev' | 'test') {
  if (target === 'dev') return loadConfiguration({ context: 'dev' })
  const url = process.env.MIGRATION_TEST_DATABASE_URL
  if (!url)
    throw new ConfigurationError('Missing configuration: MIGRATION_TEST_DATABASE_URL')
  if (process.env.DB_ENVIRONMENT && process.env.DB_ENVIRONMENT !== 'test') {
    throw new ConfigurationError('DB_ENVIRONMENT conflicts with the fixed test context')
  }
  return loadConfiguration({
    context: 'test',
    env: {
      DB_ENVIRONMENT: 'test',
      DATABASE_URL: url,
      MIGRATION_DATABASE_URL: url,
      JWT_SECRET: 'db-test',
      JWT_REFRESH_SECRET: 'db-test',
    },
    targetsPath: process.env.MIGRATION_TEST_TARGETS_PATH
      ? resolve(apiRoot, '..', '..', process.env.MIGRATION_TEST_TARGETS_PATH)
      : join(apiRoot, 'config', 'migration-test-target.json'),
  })
}

export async function devDatabaseMain(args = process.argv.slice(2)): Promise<void> {
  try {
    const [command, ...flags] = args
    if (
      !['status', 'migrate', 'test', 'seed', 'reset', 'reseed', 'rehearse'].includes(
        command
      )
    ) {
      throw new ConfigurationError(
        'Expected database command: status, migrate, seed, reseed, reset, rehearse or test'
      )
    }
    if (flags.length === 1 && flags[0] === '--help') {
      console.log(
        {
          status: 'Usage: pnpm db:status',
          migrate: 'Usage: pnpm db:migrate [--to <NNN>]',
          test: databaseTestUsage,
          seed: 'Usage: pnpm db:dev-seed --date <YYYY-MM-DD>',
          reset: resetUsage,
          reseed: reseedUsage,
          rehearse: rehearsalUsage,
        }[command]
      )
      return
    }
    if (command === 'rehearse') {
      const request = parseRehearsalArguments(flags)
      const config = loadConfiguration({ context: 'dev' })
      console.log(
        JSON.stringify({
          ...config.databaseIdentity,
          host: config.databaseTarget.directHost,
        })
      )
      console.log(JSON.stringify(await rehearseDevelopmentDatabase(config, request)))
      return
    }
    if (command === 'reset') {
      const request = parseResetArguments(flags)
      const config = loadConfiguration({ context: 'dev' })
      console.log(
        JSON.stringify({
          ...config.databaseIdentity,
          host: config.databaseTarget.directHost,
        })
      )
      console.log(JSON.stringify(await resetDevelopmentDatabase(config, request)))
      return
    }
    if (command === 'test') {
      const request = parseDatabaseTestArguments(flags)
      const config = loadMigrationTestConfiguration(request.target)
      console.log(
        JSON.stringify({
          ...config.databaseIdentity,
          host: config.databaseTarget.directHost,
        })
      )
      await runDatabaseTests(request)
      return
    }
    const reseedDate = command === 'reseed' ? parseReseedArguments(flags) : undefined
    if (
      command !== 'reseed' &&
      flags.length &&
      !(
        ['migrate', 'seed'].includes(command) &&
        flags.length === 2 &&
        flags[0] === (command === 'seed' ? '--date' : '--to') &&
        (command === 'seed' || /^\d{3}$/.test(flags[1]))
      )
    ) {
      throw new ConfigurationError('Unknown database arguments; use --help')
    }
    if (command === 'seed') validateFixtureDate(flags[1] ?? '')
    const config = loadConfiguration({ context: 'dev' })
    console.log(
      JSON.stringify({
        ...config.databaseIdentity,
        host: config.databaseTarget.directHost,
      })
    )
    const options = {
      connectionString: config.MIGRATION_DATABASE_URL,
      migrationsDir: join(apiRoot, 'src', 'db', 'migrations'),
    }
    if (command === 'seed' || command === 'reseed') {
      const password = config.DEV_FIXTURE_PASSWORD
      validateFixturePassword(password)
      const date = reseedDate ?? flags[1]
      const fill = command === 'reseed' ? reseedDevFixtures : seedDevFixtures
      await fill({
        ...options,
        connectionString:
          command === 'reseed'
            ? publicDatabaseUrl(options.connectionString)
            : options.connectionString,
        date,
        password,
      })
      console.log(
        JSON.stringify({
          fixtures: devFixtureVersion,
          date,
          result: command === 'reseed' ? 'reseeded' : 'seeded',
        })
      )
    } else if (command === 'status') {
      console.log(JSON.stringify(await getMigrationStatus(options)))
    } else {
      await runMigrations({ ...options, to: flags[1] })
    }
  } catch (error) {
    console.error(
      error instanceof ConfigurationError ||
        error instanceof MigrationError ||
        error instanceof ResetError ||
        error instanceof RehearsalError ||
        error instanceof FixtureError
        ? error.message
        : 'Database command failed: connection, migration history, target version or PostgreSQL check failed; no automatic repair was performed'
    )
    process.exitCode = 1
  }
}

if (require.main === module) void devDatabaseMain()

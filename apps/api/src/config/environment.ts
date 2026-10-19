import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'dotenv'

export class ConfigurationError extends Error {}

export type DatabaseEnvironment = 'dev' | 'production' | 'test'
type Target = {
  directHost: string
  runtimeHost: string
  port: number
  database: string
  role: string
}

export type Configuration = {
  DB_ENVIRONMENT: DatabaseEnvironment
  DATABASE_URL: string
  MIGRATION_DATABASE_URL: string
  JWT_SECRET: string
  JWT_REFRESH_SECRET: string
  DEV_FIXTURE_PASSWORD?: string
  JWT_EXPIRES_IN: string
  JWT_REFRESH_EXPIRES_IN: string
  CORS_ORIGIN: string
  databaseTarget: Target
  databaseIdentity: {
    environment: DatabaseEnvironment
    host: string
    database: string
    role: string
  }
}

const apiRoot = join(__dirname, '..', '..')

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]
  if (!value?.trim()) throw new ConfigurationError(`Missing configuration: ${key}`)
  return value
}

function readTarget(
  environment: DatabaseEnvironment,
  env: NodeJS.ProcessEnv,
  targetsPath: string
): Target {
  let target: Target | null
  if (environment === 'production') {
    // Production keeps its existing connections. Only dev/test require an independent target.
    try {
      const direct = new URL(required(env, 'MIGRATION_DATABASE_URL'))
      const runtime = new URL(required(env, 'DATABASE_URL'))
      target = {
        directHost: direct.hostname,
        runtimeHost: runtime.hostname,
        port: Number(direct.port || 5432),
        database: decodeURIComponent(direct.pathname.slice(1)),
        role: decodeURIComponent(direct.username),
      }
    } catch {
      throw new ConfigurationError('Invalid production PostgreSQL connections')
    }
  } else {
    try {
      target = JSON.parse(readFileSync(targetsPath, 'utf8'))[environment]
    } catch {
      throw new ConfigurationError('Cannot read database target configuration')
    }
  }
  if (
    !target ||
    ![target.directHost, target.runtimeHost, target.database, target.role].every(
      (value) => typeof value === 'string' && /^[a-zA-Z0-9_.-]+$/.test(value)
    ) ||
    !Number.isInteger(target.port) ||
    target.port < 1 ||
    target.port > 65535
  ) {
    throw new ConfigurationError('Incomplete database target configuration')
  }
  if (target.directHost.includes('-pooler') || target.port === 6432) {
    throw new ConfigurationError(
      'Database target requires a direct migration host and port'
    )
  }
  return target
}

function validateUrl(value: string, target: Target, migration: boolean): void {
  try {
    const url = new URL(value)
    const hosts = migration
      ? [target.directHost]
      : [target.directHost, target.runtimeHost]
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.password ||
      url.hash ||
      !hosts.includes(url.hostname) ||
      Number(url.port || 5432) !== target.port ||
      decodeURIComponent(url.username) !== target.role ||
      decodeURIComponent(url.pathname) !== `/${target.database}`
    )
      throw new ConfigurationError()
    const seen = new Set<string>()
    for (const [key, parameter] of url.searchParams) {
      // Allow only TLS settings; libpq/pg options can override both the target and search_path.
      if (
        seen.has(key) ||
        !(
          (key === 'sslmode' && ['require', 'verify-full'].includes(parameter)) ||
          (key === 'channel_binding' && parameter === 'require')
        )
      )
        throw new ConfigurationError()
      seen.add(key)
    }
  } catch {
    throw new ConfigurationError(
      `Invalid ${migration ? 'MIGRATION_DATABASE_URL' : 'DATABASE_URL'}: expected the configured PostgreSQL target and TLS parameters only`
    )
  }
}

export function validateDatabaseUrls(
  config: Pick<
    Configuration,
    'DATABASE_URL' | 'MIGRATION_DATABASE_URL' | 'databaseTarget'
  >
): void {
  validateUrl(config.DATABASE_URL, config.databaseTarget, false)
  validateUrl(config.MIGRATION_DATABASE_URL, config.databaseTarget, true)
}

export function loadConfiguration(
  options: {
    context?: DatabaseEnvironment
    env?: NodeJS.ProcessEnv
    localEnvPath?: string
    targetsPath?: string
  } = {}
): Configuration {
  let env = { ...(options.env ?? process.env) }
  let fixturePassword: string | undefined
  // Check the caller's context before reading any local secrets. NODE_ENV never selects it.
  if (options.context && env.DB_ENVIRONMENT && env.DB_ENVIRONMENT !== options.context) {
    throw new ConfigurationError('DB_ENVIRONMENT conflicts with the fixed launch context')
  }
  const environment = options.context ?? env.DB_ENVIRONMENT
  if (!['dev', 'production', 'test'].includes(environment ?? '')) {
    throw new ConfigurationError(
      'DB_ENVIRONMENT must explicitly select dev, production or test'
    )
  }
  if (environment === 'dev') {
    let local: NodeJS.ProcessEnv
    try {
      // The dedicated file is mandatory: inherited secrets may belong to production.
      local = parse(readFileSync(options.localEnvPath ?? join(apiRoot, '.env.dev.local')))
    } catch {
      throw new ConfigurationError('Cannot read local dev configuration')
    }
    if (local.DB_ENVIRONMENT && local.DB_ENVIRONMENT !== 'dev') {
      throw new ConfigurationError(
        'DB_ENVIRONMENT conflicts with the fixed launch context'
      )
    }
    for (const key of [
      'DATABASE_URL',
      'MIGRATION_DATABASE_URL',
      'JWT_SECRET',
      'JWT_REFRESH_SECRET',
    ]) {
      required(local, key)
    }
    env = { ...env, ...local }
    fixturePassword = local.DEV_FIXTURE_PASSWORD
  }
  const selected = environment as DatabaseEnvironment
  const target = readTarget(
    selected,
    env,
    options.targetsPath ?? join(apiRoot, 'config', 'database-targets.json')
  )
  const runtime = required(env, 'DATABASE_URL')
  const direct = required(env, 'MIGRATION_DATABASE_URL')
  validateUrl(runtime, target, false)
  validateUrl(direct, target, true)
  return {
    DB_ENVIRONMENT: selected,
    DATABASE_URL: runtime,
    MIGRATION_DATABASE_URL: direct,
    JWT_SECRET: required(env, 'JWT_SECRET'),
    JWT_REFRESH_SECRET: required(env, 'JWT_REFRESH_SECRET'),
    DEV_FIXTURE_PASSWORD: fixturePassword,
    JWT_EXPIRES_IN: env.JWT_EXPIRES_IN || '15m',
    JWT_REFRESH_EXPIRES_IN: env.JWT_REFRESH_EXPIRES_IN || '7d',
    CORS_ORIGIN: env.CORS_ORIGIN || 'http://localhost:5173',
    databaseTarget: target,
    databaseIdentity: {
      environment: selected,
      host: new URL(runtime).hostname,
      database: target.database,
      role: target.role,
    },
  }
}

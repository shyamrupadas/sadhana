import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { Client } from 'pg'
import { loadMigrations } from './migrate'
import { requirePublicSqlScope } from './dev-sql-scope'

type Check = { sql: string; rows: Record<string, unknown>[] }
type Phase = 'source' | 'schema' | 'data' | 'preservation'
type Scenario = { from: string; to: string; preserveTables?: string[] } & Record<
  Phase,
  Check[]
>

function readScenario(path: string, from: string, to: string): Scenario {
  const scenario = JSON.parse(readFileSync(path, 'utf8'))
  const phases: Phase[] = ['source', 'schema', 'data', 'preservation']
  if (
    !scenario ||
    scenario.from !== from ||
    scenario.to !== to ||
    Object.keys(scenario).some(
      (key) => !['from', 'to', 'preserveTables', ...phases].includes(key)
    ) ||
    (scenario.preserveTables !== undefined &&
      (!Array.isArray(scenario.preserveTables) ||
        !scenario.preserveTables.length ||
        new Set(scenario.preserveTables).size !== scenario.preserveTables.length ||
        scenario.preserveTables.some(
          (name: string) => !['users', 'habits', 'daily_entries'].includes(name)
        ))) ||
    phases.some(
      (phase) =>
        !Array.isArray(scenario[phase]) ||
        !scenario[phase].length ||
        scenario[phase].some(
          (check: Check) =>
            !check ||
            typeof check.sql !== 'string' ||
            !/^\s*(SELECT|WITH)\b/i.test(check.sql) ||
            !Array.isArray(check.rows) ||
            check.rows.some(
              (row) => !row || typeof row !== 'object' || Array.isArray(row)
            ) ||
            Object.keys(check).some((key) => !['sql', 'rows'].includes(key))
        )
    )
  )
    throw new Error('Incomplete or incompatible rehearsal scenario')
  return scenario
}

async function readPublic<T>(
  connectionString: string,
  action: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 })
  try {
    await client.connect()
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query("SET LOCAL statement_timeout = '30s'")
    const result = await action(client)
    await client.query('COMMIT')
    return result
  } finally {
    await client.end()
  }
}

export type PreparedRehearsalTarget = {
  migrationsDir: string
  check(phase: Phase, connectionString: string, date: string): Promise<void>
  snapshot(connectionString: string): Promise<unknown>
  cleanup(): Promise<void>
}

export async function prepareRehearsalTarget(options: {
  sourceMigrationsDir: string
  from: string
  to: string
  checks: string
  migrationsDir?: string
  checksDir?: string
  reviewedPrefixes?: Readonly<Record<string, string>>
}): Promise<PreparedRehearsalTarget> {
  const directory = mkdtempSync(join(tmpdir(), 'sadhana-db-rehearsal-'))
  const cleanup = async () => rmSync(directory, { recursive: true, force: true })
  try {
    if (
      !/^\d{3}$/.test(options.from) ||
      !/^\d{3}$/.test(options.to) ||
      options.to <= options.from ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(options.checks)
    )
      throw new Error('Invalid rehearsal target')
    const scenario = readScenario(
      join(
        options.checksDir ?? join(__dirname, 'rehearsal-checks'),
        `${options.checks}.json`
      ),
      options.from,
      options.to
    )
    const currentDir = options.migrationsDir ?? join(__dirname, 'migrations')
    const current = loadMigrations(currentDir)
    if (!current.some(({ id }) => id === options.to))
      throw new Error('Unknown target migration')
    const migrationsDir = join(directory, 'migrations')
    mkdirSync(migrationsDir)
    for (const migration of current.filter(({ id }) => id <= options.to)) {
      writeFileSync(
        join(migrationsDir, migration.file),
        readFileSync(join(currentDir, migration.file))
      )
    }
    // Validate the frozen bytes, never execute files from the mutable working copy.
    const target = loadMigrations(migrationsDir)
    const sourcePrefix = loadMigrations(options.sourceMigrationsDir).filter(
      ({ id }) => id <= options.from
    )
    const targetPrefix = target.filter(({ id }) => id <= options.from)
    if (
      sourcePrefix.at(-1)?.id !== options.from ||
      !isDeepStrictEqual(
        sourcePrefix.map(({ file, checksum }) => ({ file, checksum })),
        targetPrefix.map(({ file, checksum }) => ({ file, checksum }))
      )
    )
      throw new Error('Target SQL prefix differs from Git source')
    requirePublicSqlScope(target, options.to, options.reviewedPrefixes)
    let preserved: unknown
    const prepared: PreparedRehearsalTarget = {
      migrationsDir,
      async check(phase, connectionString, date) {
        await readPublic(connectionString, async (client) => {
          await client.query("SELECT set_config('sadhana.fixture_date', $1, true)", [
            date,
          ])
          for (const [index, check] of scenario[phase].entries()) {
            // Named queries use PostgreSQL's extended protocol: multiple SQL statements
            // cannot escape the read-only transaction with an embedded COMMIT.
            const result = await client.query({
              name: `rehearsal-${phase}-${index}`,
              text: check.sql,
            })
            if (!isDeepStrictEqual(result.rows, check.rows))
              throw new Error('Stored rehearsal result differs')
          }
        })
        if (scenario.preserveTables && (phase === 'source' || phase === 'preservation')) {
          const stored = (await prepared.snapshot(connectionString)) as Record<
            string,
            unknown
          >
          const selected = scenario.preserveTables.map((table) => {
            if (!Object.hasOwn(stored, table))
              throw new Error('Preserved table is missing')
            return [table, stored[table]]
          })
          if (phase === 'source') preserved = selected
          else if (!isDeepStrictEqual(selected, preserved))
            throw new Error('Migration changed preserved application records')
        }
      },
      async snapshot(connectionString) {
        return readPublic(connectionString, async (client) => {
          const relations = await client.query<{ relname: string; relkind: string }>(
            "SELECT relname, relkind FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','S') ORDER BY relname COLLATE \"C\""
          )
          const rows: Record<string, unknown> = Object.create(null)
          for (const { relname, relkind } of relations.rows) {
            const identifier = `public."${relname.replaceAll('"', '""')}"`
            rows[relname] =
              relkind === 'S'
                ? (
                    await client.query(
                      `SELECT last_value::text, is_called FROM ${identifier}`
                    )
                  ).rows
                : (
                    await client.query(
                      `SELECT to_jsonb(t)::text AS row FROM ${identifier} t ORDER BY to_jsonb(t)::text COLLATE "C"`
                    )
                  ).rows
          }
          // Text preserves exact bigint/numeric/JSON values without JS number rounding.
          // Includes every column of schema_migrations, including technical timestamps.
          return rows
        })
      },
      cleanup,
    }
    return prepared
  } catch {
    await cleanup()
    throw new Error('Rehearsal target preparation failed')
  }
}

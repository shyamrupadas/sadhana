// Dev only: node .scratch/statistics-mvp/research/statistics-http-benchmark.cjs
const assert = require('node:assert/strict')
const { AsyncLocalStorage } = require('node:async_hooks')
const { randomUUID } = require('node:crypto')
const { writeFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { cpus, platform, arch } = require('node:os')
const { join } = require('node:path')
const { performance } = require('node:perf_hooks')

const root = join(__dirname, '../../..')
const api = createRequire(join(root, 'apps/api/package.json'))
api('ts-node').register({
  project: join(root, 'apps/api/tsconfig.json'),
  transpileOnly: true,
})
const { loadConfiguration } = api('./src/config/environment')
const { StatisticsService } = api('./src/services/statistics.service')
const { E2eAccounts } = api('./test/e2e/database')
const { addDays, periodStart } = api('./src/utils/calendar')
const { Client } = api('pg')
const Fastify = api('fastify')
const app = api('./src/app').default

const measurement = new AsyncLocalStorage()
let stage = 'configuration'
const interruption = new AbortController()
const interrupt = () => interruption.abort()
const query = Client.prototype.query
Client.prototype.query = function (...args) {
  const span = measurement.getStore()
  if (!span) return query.apply(this, args)
  const started = performance.now()
  span.sqlCount++
  return query.apply(this, args).then((result) => {
    span.sqlMs += performance.now() - started
    span.lastSqlCpu = process.cpuUsage()
    span.sqlRows += result.rowCount ?? 0
    return result
  })
}
const statistics = StatisticsService.prototype.getStatistics
let lastSpan
StatisticsService.prototype.getStatistics = function (...args) {
  const span = { sqlCount: 0, sqlMs: 0, sqlRows: 0 }
  return measurement.run(span, async () => {
    const result = await statistics.apply(this, args)
    const cpu = process.cpuUsage(span.lastSqlCpu)
    span.calculationCpuMs = (cpu.user + cpu.system) / 1000
    lastSpan = span
    return result
  })
}

const rounded = (value) => Math.round(value * 100) / 100
function summary(samples) {
  const sorted = samples.toSorted((a, b) => a - b)
  return {
    min: rounded(sorted[0]),
    median: rounded(sorted[Math.floor(sorted.length / 2)]),
    p95: rounded(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    max: rounded(sorted.at(-1)),
  }
}
function windowFor(asOfDate, granularity, count) {
  const toExclusive =
    granularity === 'day' ? addDays(asOfDate, 1) : periodStart(asOfDate, granularity)
  let from
  if (granularity === 'day' || granularity === 'week')
    from = addDays(toExclusive, -count * (granularity === 'week' ? 7 : 1))
  else {
    const date = new Date(`${toExclusive}T00:00:00Z`)
    if (granularity === 'month') date.setUTCMonth(date.getUTCMonth() - count)
    else date.setUTCFullYear(date.getUTCFullYear() - count)
    from = date.toISOString().slice(0, 10)
  }
  return { granularity, from, toExclusive, asOfDate, includeArchived: 'true' }
}

async function main() {
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  const config = loadConfiguration({ context: 'dev' })
  const client = new Client({
    connectionString: config.MIGRATION_DATABASE_URL,
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
  })
  const server = Fastify({ logger: false })
  const runId = randomUUID()
  const accounts = new E2eAccounts(
    join(root, 'apps/api/.statistics-benchmark.local'),
    JSON.stringify(config.databaseTarget),
    client
  )
  let tracked = false
  try {
    stage = 'dev connection'
    await client.connect()
    const identity = (
      await client.query('SELECT current_database() AS database, current_user AS role')
    ).rows[0]
    assert.equal(identity.database, config.databaseTarget.database)
    assert.equal(identity.role, config.databaseTarget.role)
    stage = 'runtime schema verification'
    server.register(api('fastify-plugin')(app), {
      dbEnvironment: 'dev',
      verifySchema: true,
    })
    await server.ready()
    const base = await server.listen({ host: '127.0.0.1', port: 0 })
    const asOfDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
    }).format(new Date())
    const historyFrom = `${Number(asOfDate.slice(0, 4)) - 10}-${asOfDate.slice(5)}`
    stage = 'real profile selection'
    const real = await client.query(`SELECT u.id, u.email,
      (SELECT count(*)::int FROM sleep_records s WHERE s.user_id = u.id) AS sleep_rows,
      (SELECT count(*)::int FROM habits h WHERE h.user_id = u.id) AS habit_count,
      (SELECT count(*)::int FROM habit_marks m WHERE m.user_id = u.id) AS mark_count
      FROM users u WHERE u.email NOT LIKE '%@example.test'
      AND EXISTS (SELECT 1 FROM sleep_records s WHERE s.user_id = u.id)
      ORDER BY sleep_rows DESC LIMIT 1`)
    stage = 'synthetic account'
    await accounts.start(runId, process.pid)
    tracked = true
    const reserved = accounts.reserve(runId)
    const synthetic = await accounts.seed(runId, reserved.email, randomUUID())
    stage = 'synthetic history'
    await client.query('BEGIN')
    try {
      await client.query(
        `INSERT INTO habits (user_id, label, start_date, archived, created_at)
        SELECT $1, 'Synthetic ' || n, $2::date, n > 80, $2::timestamp
        FROM generate_series(1, 100) n`,
        [synthetic.id, historyFrom]
      )
      await client.query(
        `INSERT INTO sleep_records (user_id, date, bedtime, wake_time, nap_minutes)
        SELECT $1, d::date, d::timestamp + interval '23 hours', d::timestamp + interval '7 hours',
        CASE WHEN extract(doy FROM d)::int % 5 = 0 THEN 30 ELSE 0 END
        FROM generate_series($2::date, $3::date, interval '1 day') d`,
        [synthetic.id, historyFrom, asOfDate]
      )
      await client.query(
        `INSERT INTO habit_marks (user_id, date, habit_id, value)
        SELECT $1, d::date, h.id, extract(doy FROM d)::int % 3 <> 0
        FROM habits h CROSS JOIN generate_series($2::date, $3::date, interval '1 day') d
        WHERE h.user_id = $1`,
        [synthetic.id, historyFrom, asOfDate]
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
    const profiles = [{ label: 'synthetic-100-habits', ...synthetic }]
    if (real.rows.length) profiles.push({ label: 'real-dev-history', ...real.rows[0] })
    const results = {
      measuredAt: new Date().toISOString(),
      node: process.version,
      system: `${platform()} ${arch()}`,
      cpu: cpus()[0].model,
      environment:
        'Local source API over loopback HTTP, real configured dev PostgreSQL; sequential requests, no compression',
      asOfDate,
      syntheticHistoryYears: 10,
      repetitions: 20,
      realHistoryAvailable: real.rows.length > 0,
      realCounts: real.rows.length
        ? {
            sleepRows: real.rows[0].sleep_rows,
            habits: real.rows[0].habit_count,
            marks: real.rows[0].mark_count,
          }
        : null,
      limitations: [
        'First request per window is reported separately; only the first window is the first process request, after schema verification and seeding.',
        'SQL time includes network, PostgreSQL execution and pg row parsing; it is not server-only EXPLAIN execution time.',
        'Calculation CPU is process CPU after the final SQL response until the service returns; serialization is included only in total HTTP time.',
        'Local dev measurements do not establish production latency. Real profile is read-only; result contains no account identifiers or values.',
      ],
      windows: [],
    }
    stage = 'HTTP measurements'
    for (const profile of profiles) {
      const token = server.jwt.sign({
        userId: profile.id,
        email: profile.email,
        type: 'access',
      })
      for (const [granularity, ordinary, maximum] of [
        ['day', 7, 48],
        ['week', 4, 24],
        ['month', 3, 12],
        ['year', 1, 4],
      ]) {
        for (const [size, count] of [
          ['ordinary', ordinary],
          ['maximum', maximum],
        ]) {
          const range = windowFor(asOfDate, granularity, count)
          const url = `${base}/statistics?${new URLSearchParams(range)}`
          async function request() {
            lastSpan = undefined
            const before = performance.now()
            const response = await fetch(url, {
              headers: { authorization: `Bearer ${token}` },
              signal: interruption.signal,
            })
            const body = await response.text()
            const totalMs = performance.now() - before
            assert.equal(response.status, 200, 'Statistics request failed')
            const data = JSON.parse(body)
            assert.equal(data.columns.length, count)
            if (profile.label === 'synthetic-100-habits') {
              assert.equal(data.habits.length, 100)
              for (const column of data.columns) {
                const days =
                  (+new Date(column.toExclusive) - +new Date(column.from)) / 86400000
                for (const habit of column.habits)
                  assert.equal(habit.trueCount + habit.falseCount, days)
              }
            }
            assert.equal(lastSpan.sqlCount, 4)
            return { totalMs, bytes: Buffer.byteLength(body), ...lastSpan }
          }
          const cold = await request()
          const warm = []
          for (let n = 0; n < 20; n++) warm.push(await request())
          const result = {
            profile: profile.label,
            granularity,
            size,
            columns: count,
            sourceDays: (+new Date(range.toExclusive) - +new Date(range.from)) / 86400000,
            coldMs: rounded(cold.totalMs),
            totalMs: summary(warm.map((s) => s.totalMs)),
            sqlCount: 4,
            sqlRows: warm[0].sqlRows,
            sqlMs: summary(warm.map((s) => s.sqlMs)),
            calculationCpuMs: summary(warm.map((s) => s.calculationCpuMs)),
            responseBytes: warm[0].bytes,
            withinOneSecond: warm.filter((s) => s.totalMs <= 1000).length,
          }
          results.windows.push(result)
          console.log(
            `${profile.label} ${granularity}/${size}: p95=${result.totalMs.p95} ms, <=1s ${result.withinOneSecond}/20, ${result.responseBytes} bytes`
          )
        }
      }
    }
    results.passed = results.windows.every((window) => window.withinOneSecond >= 19)
    writeFileSync(
      join(__dirname, 'statistics-http-results.json'),
      JSON.stringify(results, null, 2) + '\n'
    )
    if (!results.passed) process.exitCode = 1
  } finally {
    await server.close()
    try {
      if (tracked) await accounts.finish(runId)
    } finally {
      await client.end()
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', interrupt)
    }
  }
}

main().catch((error) => {
  const code =
    typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : error.name
  console.error(
    `Dev benchmark failed at ${stage} (${code}). No SQL, secrets or records are printed. Cleanup manifest is in apps/api/.statistics-benchmark.local.`
  )
  process.exitCode = 1
})

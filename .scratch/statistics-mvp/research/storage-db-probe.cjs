// Read-only measurement; never prints credentials, user IDs or stored records.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { performance } = require('node:perf_hooks')
const repoRoot = path.resolve(__dirname, '../../..')
const requireApi = createRequire(path.join(repoRoot, 'apps/api/package.json'))
const { Client } = requireApi('pg')
const env = requireApi('dotenv').parse(fs.readFileSync(path.join(repoRoot, 'apps/api/.env.local')))
let diagnosticUserId = process.env.STATISTICS_DIAGNOSTIC_USER_ID
if (!diagnosticUserId && fs.existsSync('/private/tmp/sadhana-statistics-diagnosis.cjs')) {
  const priorProbe = fs.readFileSync('/private/tmp/sadhana-statistics-diagnosis.cjs', 'utf8')
  diagnosticUserId = priorProbe.match(/(?:userId|USER_ID)\s*=\s*['"]([0-9a-fA-F-]{36})['"]/)?.[1]
}
if (!diagnosticUserId) throw new Error('Set STATISTICS_DIAGNOSTIC_USER_ID for the authorized account')
const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 15000 })
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const round = (x) => Math.round(x * 1000) / 1000
const filters = 'user_id = $1 AND date >= $2 AND date < $3'
const queries = {
  rangeJsonb: `SELECT date, sleep_data, habits FROM daily_entries WHERE ${filters} ORDER BY date`,
  projection: `SELECT date, sleep_data->>'bedtime' AS bedtime, sleep_data->>'wakeTime' AS wake_time,
    COALESCE((sleep_data->>'napDuration')::int,0) AS nap_minutes, habits
    FROM daily_entries WHERE ${filters} ORDER BY date`,
  sleepPartialAggregate: `SELECT substring(date,1,7) AS period,
    count(*) FILTER (WHERE sleep_data->>'bedtime' IS NOT NULL) AS bedtime_count,
    count(*) FILTER (WHERE sleep_data->>'wakeTime' IS NOT NULL) AS wake_count,
    sum(COALESCE((sleep_data->>'napDuration')::int,0)) AS nap_sum
    FROM daily_entries WHERE ${filters} GROUP BY period ORDER BY period`,
  habitAggregate: `SELECT substring(e.date,1,7) AS period, h->>'key' AS key,
    count(*) FILTER (WHERE h->>'value'='true') AS true_count,
    count(*) FILTER (WHERE h->>'value'='false') AS false_count
    FROM daily_entries e CROSS JOIN LATERAL jsonb_array_elements(e.habits) h
    WHERE ${filters} GROUP BY period,key ORDER BY period,key`,
}
async function measure(sql, params) {
  // First request warms the plan/data path; following measurements share one connection.
  let result = await client.query(sql, params)
  const elapsed = []
  for (let run = 0; run < 5; run++) {
    const begin = performance.now()
    result = await client.query(sql, params)
    elapsed.push(performance.now() - begin)
  }
  const planResult = await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, params)
  const plan = planResult.rows[0]['QUERY PLAN'][0]
  const nodes = new Set()
  function visit(node) {
    nodes.add(node['Node Type'])
    for (const child of node.Plans ?? []) visit(child)
  }
  visit(plan.Plan)
  return {
    rows: result.rows,
    metric: {
      returnedRows: result.rowCount,
      resultJsonBytes: Buffer.byteLength(JSON.stringify(result.rows)),
      medianClientMs: round(median(elapsed)),
      minClientMs: round(Math.min(...elapsed)), maxClientMs: round(Math.max(...elapsed)),
      explainExecutionMs: plan['Execution Time'], explainPlanningMs: plan['Planning Time'],
      planNodes: [...nodes], sharedHitBlocks: plan.Plan['Shared Hit Blocks'],
    },
  }
}
async function main() {
  await client.connect()
  await client.query('BEGIN READ ONLY')
  await client.query("SET LOCAL statement_timeout = '8s'")
  const bound = (await client.query(
    'SELECT min(date) AS first, max(date) AS last, count(*) AS rows FROM daily_entries WHERE user_id=$1',
    [diagnosticUserId]
  )).rows[0]
  if (!bound.last) throw new Error('Authorized account has no records')
  const end = new Date(bound.last + 'T00:00:00Z')
  end.setUTCDate(end.getUTCDate() + 1)
  const toExclusive = end.toISOString().slice(0, 10)
  const schema = (await client.query(`SELECT current_setting('server_version_num') AS version,
    (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='daily_entries') AS index_count`)).rows[0]
  const physicalSizes = (await client.query(`SELECT count(*) AS rows,
    round(avg(pg_column_size(sleep_data)),1) AS mean_sleep_bytes,
    round(avg(pg_column_size(habits)),1) AS mean_habits_bytes,
    max(jsonb_array_length(habits)) AS max_marks_per_day,
    sum(jsonb_array_length(habits)) AS total_marks
    FROM daily_entries WHERE user_id=$1`, [diagnosticUserId])).rows[0]
  const report = { recordedAt: new Date().toISOString(), kind: 'real-authorized-account-read-only',
    measurement: 'PostgreSQL execution and local client path; not production HTTP; partial SQL aggregates only',
    schema, physicalSizes, profiles: [] }
  for (const days of [31, 365, 3654]) {
    const from = new Date(end)
    // Include the preceding calendar date used for the first night.
    from.setUTCDate(from.getUTCDate() - days - 1)
    const params = [diagnosticUserId, from.toISOString().slice(0, 10), toExclusive]
    const profile = { requestedDays: days, includesPrecedingDay: true, queries: {}, checks: {} }
    const results = {}
    for (const [name, sql] of Object.entries(queries)) {
      results[name] = await measure(sql, params)
      profile.queries[name] = results[name].metric
    }
    assert.equal(results.rangeJsonb.rows.length, results.projection.rows.length)
    const expected = new Map()
    const expectedHabits = new Map()
    for (const row of results.rangeJsonb.rows) {
      const period = row.date.slice(0,7)
      const group = expected.get(period) ?? { bedtime_count: 0, wake_count: 0, nap_sum: 0 }
      group.bedtime_count += row.sleep_data.bedtime != null ? 1 : 0
      group.wake_count += row.sleep_data.wakeTime != null ? 1 : 0
      group.nap_sum += row.sleep_data.napDuration ?? 0
      expected.set(period,group)
      for (const mark of row.habits) {
        const key = period + '\u0000' + mark.key
        const count = expectedHabits.get(key) ?? { true_count: 0, false_count: 0 }
        if (mark.value === true) count.true_count++
        if (mark.value === false) count.false_count++
        expectedHabits.set(key,count)
      }
    }
    for (const row of results.sleepPartialAggregate.rows) {
      const actual = { bedtime_count: Number(row.bedtime_count), wake_count: Number(row.wake_count), nap_sum: Number(row.nap_sum) }
      if (JSON.stringify(actual) !== JSON.stringify(expected.get(row.period))) throw new Error('Partial sleep aggregate mismatch')
    }
    if (expected.size !== results.sleepPartialAggregate.rows.length) throw new Error('Missing sleep group')
    for (const row of results.habitAggregate.rows) {
      const actual = { true_count: Number(row.true_count), false_count: Number(row.false_count) }
      if (JSON.stringify(actual) !== JSON.stringify(expectedHabits.get(row.period+'\u0000'+row.key))) throw new Error('Habit aggregate mismatch')
    }
    if (expectedHabits.size !== results.habitAggregate.rows.length) throw new Error('Missing habit group')
    profile.checks = { matchingRowCounts: true, partialSleepAggregateMatchesApi: true, habitAggregateMatchesApi: true }
    report.profiles.push(profile)
  }
  await client.query('ROLLBACK')
  const target = path.join(__dirname, 'storage-db-results.json')
  fs.writeFileSync(target, JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report))
}
main().catch((error) => {
  // Error messages/details may contain the connection host or source values.
  console.error(JSON.stringify({ failed: true, errorCode: error.code ?? 'PROBE_FAILED' }))
  process.exitCode = 1
}).finally(async () => {
  try { await client.query('ROLLBACK') } catch {}
  try { await client.end() } catch {}
})

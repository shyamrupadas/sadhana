#!/usr/bin/env node
// Исследовательский стенд, не тест приложения и не реализация будущего API.
// Воспроизведение: node .scratch/statistics-mvp/research/storage-benchmark.cjs
// Только вымышленные данные; БД, сеть, файловая система приложения не меняются.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { performance } = require('node:perf_hooks')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '../../..')
const apiRequire = createRequire(path.join(root, 'apps/api/package.json'))
apiRequire('ts-node').register({ transpileOnly: true, project: path.join(root, 'apps/api/tsconfig.json') })
const actual = require(path.join(root, 'apps/api/src/utils/datetime.ts'))
const actualStats = require(path.join(root, 'apps/api/src/utils/stats.ts'))
const MS_DAY = 86400000
const DEFAULT_TZ = 'Europe/Moscow'
const WARMUPS = 3
const REPEATS = 9
const START = '2024-01-01' // Понедельник и начало месяца/года: 3653 дня составляют ровно 10 календарных лет.
process.env.TZ = DEFAULT_TZ

function ordinal(date) {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / MS_DAY
}
function calendarDate(day) { return new Date(day * MS_DAY).toISOString().slice(0, 10) }
function minuteOfDay(timestamp) { return timestamp === null ? null : Number(timestamp.slice(11, 13)) * 60 + Number(timestamp.slice(14, 16)) }
function localEpochMinutes(timestamp) {
  if (timestamp === null) return null
  // Сохраняет текущую семантику Day.js: местный TZ процесса, включая DST.
  return new Date(Number(timestamp.slice(0, 4)), Number(timestamp.slice(5, 7)) - 1,
    Number(timestamp.slice(8, 10)), Number(timestamp.slice(11, 13)), Number(timestamp.slice(14, 16))).getTime() / 60000
}
function candidateDuration(bed, wake, nap) {
  if (bed === null || wake === null) return null
  let diff = Math.trunc(wake - bed)
  if (diff < 0) diff += 1440
  let total = diff + (nap ?? 0)
  if (total > 1440) total -= 1440
  return Math.max(0, Math.min(1440, total))
}
function measure(fn) {
  for (let i = 0; i < WARMUPS; i++) fn()
  const samples = []
  let result
  for (let i = 0; i < REPEATS; i++) {
    const before = performance.now()
    result = fn()
    samples.push(performance.now() - before)
  }
  samples.sort((a, b) => a - b)
  return { medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(3)),
    minMs: Number(samples[0].toFixed(3)), maxMs: Number(samples.at(-1).toFixed(3)), result }
}
function timingOnly(measured) {
  const { result, ...timing } = measured
  return timing
}
function makeFixture(days, habitCount) {
  const from = ordinal(START)
  const today = from + days - 1
  const definitions = Array.from({ length: habitCount }, (_, h) => ({
    key: `habit-${String(h).padStart(3, '0')}`, label: `Вымышленная привычка ${h + 1}`,
    activeFrom: calendarDate(from + h % Math.min(90, Math.max(1, Math.floor(days / 3)))),
    activeThrough: h % 7 === 0 ? calendarDate(from + Math.floor((days - 1) * 0.65)) : null,
  }))
  const rows = []
  for (let i = -1; i < days; i++) {
    if (i >= 0 && i % 17 === 8) continue // Пропущенный календарный день, а не просто неполная строка.
    const day = from + i
    const date = calendarDate(day)
    const bedtime = i % 7 === 3 ? null : i % 3 === 1 ? `${calendarDate(day + 1)} 01:15` : `${date} 23:15`
    const wakeTime = i % 11 === 4 ? null : `${date} ${i % 13 === 0 ? '13:00' : '07:30'}`
    const napDuration = i % 5 === 0 ? 30 + (Math.abs(i) % 3) * 30 : null
    const habits = definitions.flatMap((definition, h) => {
      if (i < 0 || date < definition.activeFrom || (definition.activeThrough !== null && date > definition.activeThrough) || (i + h) % 5 === 0) return []
      return [{ key: definition.key, value: (i + h) % 3 !== 0 }]
    })
    rows.push({ date, sleep: { bedtime, wakeTime, napDuration, duration: null }, habits })
  }
  return { from, today, days, habitCount, definitions, rows }
}
function existingHelperDays(fixture) {
  const byDate = new Map(fixture.rows.map(row => [row.date, row]))
  const days = []
  for (let day = fixture.from; day <= fixture.today; day++) {
    const date = calendarDate(day)
    const row = byDate.get(date)
    const sleep = row?.sleep ?? { bedtime: null, wakeTime: null, napDuration: null }
    const previous = byDate.get(actual.getPreviousDate(date))
    days.push({ date, bedtimeMinutes: sleep.bedtime === null ? null : minuteOfDay(`${date} ${actual.formatTime(sleep.bedtime)}`),
      wakeTimeMinutes: sleep.wakeTime === null ? null : minuteOfDay(`${date} ${actual.formatTime(sleep.wakeTime)}`),
      napDuration: sleep.napDuration ?? 0,
      duration: actual.calculateSleepDuration(previous?.sleep.bedtime ?? null, sleep.wakeTime, sleep.napDuration),
      habits: row?.habits ?? [] })
  }
  return days
}
function preparedRows(fixture) {
  return new Map(fixture.rows.map(row => [ordinal(row.date), {
    bedtimeMinutes: minuteOfDay(row.sleep.bedtime), wakeTimeMinutes: minuteOfDay(row.sleep.wakeTime),
    bedtimeEpoch: localEpochMinutes(row.sleep.bedtime), wakeTimeEpoch: localEpochMinutes(row.sleep.wakeTime),
    napDuration: row.sleep.napDuration ?? 0, habits: row.habits,
  }]))
}
function candidateDay(day, rows) {
  const row = rows.get(day)
  const previous = rows.get(day - 1) // Точный календарный сосед: пропуск не превращается в предыдущую строку.
  return { date: calendarDate(day), bedtimeMinutes: row?.bedtimeMinutes ?? null,
    wakeTimeMinutes: row?.wakeTimeMinutes ?? null, napDuration: row?.napDuration ?? 0,
    duration: candidateDuration(previous?.bedtimeEpoch ?? null, row?.wakeTimeEpoch ?? null, row?.napDuration ?? 0),
    habits: row?.habits ?? [] }
}
function periodKey(day, scale) {
  if (scale === 'day') return calendarDate(day)
  if (scale === 'week') return calendarDate(day - (new Date(day * MS_DAY).getUTCDay() + 6) % 7)
  const date = calendarDate(day)
  return scale === 'month' ? `${date.slice(0, 7)}-01` : `${date.slice(0, 4)}-01-01`
}
function makeBucket(start, definitions) {
  return { start, calendarDays: 0, bedtimeSum: 0, bedtimeCount: 0,
    wakeTimeSum: 0, wakeTimeCount: 0, napSum: 0, durationSum: 0, durationCount: 0,
    habits: definitions.map(def => ({ key: def.key, trueCount: 0, falseCount: 0, eligibleDays: 0 })) }
}
function addDay(bucket, day, definitions, indices) {
  bucket.calendarDays++
  if (day.bedtimeMinutes !== null) { bucket.bedtimeSum += day.bedtimeMinutes < 720 ? day.bedtimeMinutes + 1440 : day.bedtimeMinutes; bucket.bedtimeCount++ }
  if (day.wakeTimeMinutes !== null) { bucket.wakeTimeSum += day.wakeTimeMinutes; bucket.wakeTimeCount++ }
  bucket.napSum += day.napDuration
  if (day.duration !== null) { bucket.durationSum += day.duration; bucket.durationCount++ }
  // Этот прямой стенд O(D * H + M), где M — число существующих отметок.
  // eligibleDays можно считать пересечением интервалов O(P * H); здесь намеренно простая верхняя оценка.
  for (let h = 0; h < definitions.length; h++) {
    const definition = definitions[h]
    if (day.date >= definition.activeFrom && (definition.activeThrough === null || day.date <= definition.activeThrough)) bucket.habits[h].eligibleDays++
  }
  for (const mark of day.habits) {
    const index = indices.get(mark.key)
    assert.notEqual(index, undefined)
    bucket.habits[index][mark.value ? 'trueCount' : 'falseCount']++
  }
}
function finalize(bucket) {
  return { start: bucket.start, calendarDays: bucket.calendarDays,
    bedtimeMinutes: bucket.bedtimeCount ? Math.round(bucket.bedtimeSum / bucket.bedtimeCount) % 1440 : null,
    wakeTimeMinutes: bucket.wakeTimeCount ? Math.round(bucket.wakeTimeSum / bucket.wakeTimeCount) : null,
    napDuration: Math.round(bucket.napSum / bucket.calendarDays),
    duration: bucket.durationCount ? Math.round(bucket.durationSum / bucket.durationCount) : null,
    sampleCounts: { bedtime: bucket.bedtimeCount, wakeTime: bucket.wakeTimeCount, duration: bucket.durationCount },
    habits: bucket.habits.map(habit => ({ ...habit, successPercent: habit.trueCount + habit.falseCount ? Math.round(100 * habit.trueCount / (habit.trueCount + habit.falseCount)) : null })) }
}
function aggregateDays(days, fixture, scale) {
  if (scale === 'day') return days
  const buckets = new Map()
  const indices = new Map(fixture.definitions.map((d, i) => [d.key, i]))
  for (let i = 0; i < days.length; i++) {
    const key = periodKey(fixture.from + i, scale)
    if (!buckets.has(key)) buckets.set(key, makeBucket(key, fixture.definitions))
    addDay(buckets.get(key), days[i], fixture.definitions, indices)
  }
  return [...buckets.values()].map(finalize)
}
function candidatePipeline(fixture, scale) {
  const rows = preparedRows(fixture)
  if (scale === 'day') return Array.from({ length: fixture.days }, (_, i) => candidateDay(fixture.from + i, rows))
  const buckets = new Map()
  const indices = new Map(fixture.definitions.map((d, i) => [d.key, i]))
  for (let day = fixture.from; day <= fixture.today; day++) {
    const key = periodKey(day, scale)
    if (!buckets.has(key)) buckets.set(key, makeBucket(key, fixture.definitions))
    addDay(buckets.get(key), candidateDay(day, rows), fixture.definitions, indices)
  }
  return [...buckets.values()].map(finalize)
}
function referenceAggregates(days, fixture, scale) {
  if (scale === 'day') return days
  const keys = [...new Set(days.map((_, i) => periodKey(fixture.from + i, scale)))]
  return keys.map(start => {
    const group = days.filter((_, i) => periodKey(fixture.from + i, scale) === start)
    const beds = group.flatMap(d => d.bedtimeMinutes === null ? [] : [d.bedtimeMinutes])
    const wakes = group.flatMap(d => d.wakeTimeMinutes === null ? [] : [d.wakeTimeMinutes])
    const durations = group.flatMap(d => d.duration === null ? [] : [d.duration])
    const timeString = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const bedtime = actualStats.calculateAverageTime(beds.map(timeString))
    return { start, calendarDays: group.length,
      bedtimeMinutes: bedtime === null ? null : minuteOfDay(`${start} ${bedtime}`),
      wakeTimeMinutes: wakes.length ? Math.round(wakes.reduce((a, b) => a + b, 0) / wakes.length) : null,
      napDuration: Math.round(group.reduce((a, b) => a + b.napDuration, 0) / group.length),
      duration: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      sampleCounts: { bedtime: beds.length, wakeTime: wakes.length, duration: durations.length },
      habits: fixture.definitions.map(def => {
        const marks = group.flatMap(d => d.habits.filter(h => h.key === def.key))
        const trueCount = marks.filter(h => h.value).length
        const falseCount = marks.length - trueCount
        const eligibleDays = group.filter(d => d.date >= def.activeFrom && (def.activeThrough === null || d.date <= def.activeThrough)).length
        return { key: def.key, trueCount, falseCount, eligibleDays, successPercent: marks.length ? Math.round(100 * trueCount / marks.length) : null }
      }) }
  })
}
function validate() {
  let durationProbes = 0
  const durations = [
    [null, '2026-10-10 07:00', 30], ['2026-10-09 23:00', null, null],
    ['2026-10-09 23:00', '2026-10-10 07:00', null],
    ['2026-10-10 23:00', '2026-10-10 07:00', 30],
    ['2026-10-09 00:00', '2026-10-10 00:00', 0],
    ['2026-10-09 00:00', '2026-10-11 00:00', 120],
    ['2026-10-11 00:00', '2026-10-09 00:00', 30],
    ['2026-03-07 23:00', '2026-03-08 07:00', 30],
    ['2026-10-31 23:00', '2026-11-01 07:00', null],
    ['2026-03-08 02:30', '2026-03-08 07:00', null],
    ['2024-02-29 23:59', '2024-03-01 00:01', null],
  ]
  for (const tz of ['Europe/Moscow', 'America/New_York', 'Europe/Berlin']) {
    process.env.TZ = tz
    for (const [bed, wake, nap] of durations) {
      assert.equal(candidateDuration(localEpochMinutes(bed), localEpochMinutes(wake), nap), actual.calculateSleepDuration(bed, wake, nap), `${tz}: ${bed} / ${wake}`)
      durationProbes++
    }
  }
  process.env.TZ = DEFAULT_TZ
  const fixture = makeFixture(400, 10)
  const referenceDays = existingHelperDays(fixture)
  assert.deepEqual(candidatePipeline(fixture, 'day'), referenceDays)
  assert.equal(referenceDays[9].duration, null) // День 8 отсутствует: нельзя брать отбой дня 7.
  for (const scale of ['week', 'month', 'year']) assert.deepEqual(candidatePipeline(fixture, scale), referenceAggregates(referenceDays, fixture, scale))
  const empty = { ...makeFixture(7, 1), rows: [] }
  const noData = candidatePipeline(empty, 'week')[0]
  assert.equal(noData.napDuration, 0)
  assert.equal(noData.bedtimeMinutes, null)
  assert.equal(noData.wakeTimeMinutes, null)
  assert.equal(noData.duration, null)
  assert.equal(noData.habits[0].successPercent, null)
  assert.equal(noData.habits[0].eligibleDays, 4) // Архивный synthetic habit: удаление включительно.
  const probeDays = Array.from({ length: 7 }, (_, i) => ({ date: calendarDate(fixture.from + i),
    bedtimeMinutes: i < 2 ? [1380, 60][i] : null, wakeTimeMinutes: i < 2 ? [660, 780][i] : null,
    napDuration: i < 2 ? [30, 60][i] : 0, duration: null, habits: [] }))
  const means = aggregateDays(probeDays, fixture, 'week')[0]
  assert.equal(means.bedtimeMinutes, 0)
  assert.equal(means.wakeTimeMinutes, 720)
  assert.equal(means.napDuration, 13)
  assert.equal(means.duration, null)
  const habitProbe = { ...fixture, definitions: [{ key: 'probe', label: 'Проба', activeFrom: START, activeThrough: null }] }
  const markedDays = probeDays.map((day, i) => ({ ...day, habits: i < 5 ? [{ key: 'probe', value: i < 4 }] : [] }))
  const habitMeans = aggregateDays(markedDays, habitProbe, 'week')[0].habits[0]
  assert.deepEqual(habitMeans, { key: 'probe', trueCount: 4, falseCount: 1, eligibleDays: 7, successPercent: 80 })
  const oppositeWake = aggregateDays(probeDays.map((day, i) => ({ ...day, wakeTimeMinutes: i < 2 ? [0, 720][i] : null })), fixture, 'week')[0]
  assert.equal(oppositeWake.wakeTimeMinutes, 360)
  return { passed: true, durationProbes, timezones: ['Europe/Moscow', 'America/New_York', 'Europe/Berlin'],
    canonicalInputScope: 'Valid Gregorian YYYY-MM-DD HH:mm, null, minute precision. Invalid/noncanonical timestamps are outside candidate scope.',
    cases: ['exact previous calendar date with gaps', 'duration null and existing wrap/clamp', 'DST spring/fall and missing local time',
      'leap day', 'independent bedtime/wake/duration samples', 'night scale bedtime vs arithmetic wake',
      'empty-calendar nap zeros', 'creation/archive inclusive', 'week/month/year scalar and habit counts', '4 true + 1 false + 2 unmarked => 80%, eligible 7', 'empty habit success null'] }
}
function profile(days, habitCount) {
  const fixture = makeFixture(days, habitCount)
  const rawJsonRows = fixture.rows.map(row => ({ date: row.date, sleep: JSON.stringify(row.sleep), habits: JSON.stringify(row.habits) }))
  const normalizedMarks = fixture.rows.flatMap(row => row.habits.map(mark => ({ date: row.date, ...mark })))
  const typedSleepRows = fixture.rows.map(row => ({ date: row.date, bedtime: row.sleep.bedtime, wakeTime: row.sleep.wakeTime, napDuration: row.sleep.napDuration, duration: row.sleep.duration }))
  const jsonMaterialization = measure(() => rawJsonRows.map(row => ({ date: row.date, sleep: JSON.parse(row.sleep), habits: JSON.parse(row.habits) })))
  const typedMaterialization = measure(() => {
    const rows = typedSleepRows.map(row => ({ date: row.date, sleep: { bedtime: row.bedtime, wakeTime: row.wakeTime, napDuration: row.napDuration, duration: row.duration }, habits: [] }))
    const byDate = new Map(rows.map(row => [row.date, row]))
    for (const mark of normalizedMarks) byDate.get(mark.date).habits.push({ key: mark.key, value: mark.value })
    return rows
  })
  assert.deepEqual(jsonMaterialization.result, typedMaterialization.result)
  const fixtureByDate = new Map(fixture.rows.map(row => [row.date, row]))
  const fullDays = fixture.rows.filter(row => ordinal(row.date) >= fixture.from).map(row => ({ id: row.date, date: row.date,
    sleep: { ...row.sleep, duration: actual.calculateSleepDuration(fixtureByDate.get(actual.getPreviousDate(row.date))?.sleep.bedtime ?? null, row.sleep.wakeTime, row.sleep.napDuration) }, habits: row.habits }))
  const serializeRaw = measure(() => JSON.stringify({ definitions: fixture.definitions, entries: fullDays }))
  const scales = {}
  for (const scale of ['day', 'week', 'month', 'year']) {
    const helper = measure(() => aggregateDays(existingHelperDays(fixture), fixture, scale))
    const candidate = measure(() => candidatePipeline(fixture, scale))
    assert.deepEqual(candidate.result, helper.result)
    const serialized = measure(() => JSON.stringify({ definitions: fixture.definitions, columns: candidate.result }))
    scales[scale] = { columns: candidate.result.length, helperPipeline: timingOnly(helper), candidatePipeline: timingOnly(candidate),
      jsonSerialization: timingOnly(serialized), uncompressedJsonBytes: Buffer.byteLength(serialized.result),
      helperToCandidateMedianRatio: Number((helper.medianMs / candidate.medianMs).toFixed(2)) }
  }
  return { days, habits: habitCount, from: START, through: calendarDate(fixture.today), sourceRowsWithOneDayHalo: fixture.rows.length,
    marksWithHalo: normalizedMarks.length, materialization: { jsonParse: timingOnly(jsonMaterialization),
      typedObjectReconstruction: timingOnly(typedMaterialization), jsonRowPayloadBytes: rawJsonRows.reduce((n, row) => n + Buffer.byteLength(row.sleep) + Buffer.byteLength(row.habits), 0) },
    fullDailyResponse: { existingRows: fullDays.length, jsonSerialization: timingOnly(serializeRaw), uncompressedJsonBytes: Buffer.byteLength(serializeRaw.result) }, scales }
}

const results = { measuredAtUtc: new Date().toISOString(), node: process.version, platform: process.platform,
  architecture: process.arch, cpu: os.cpus()[0]?.model, logicalCpuCount: os.cpus().length, processTimezone: DEFAULT_TZ,
  warmups: WARMUPS, measuredRepeats: REPEATS, statistic: 'median, min, max of warmed process.perf_hooks.performance timings; no explicit GC',
  inputs: { realDataUsed: false, syntheticStart: START, days: [31, 365, 3653, 3654], habits: [10, 100], missingRowsEvery: 17,
    missingBedtimeEvery: 7, missingWakeEvery: 11, sparseMarks: 'Every fifth eligible habit-day unmarked; mixed true/false; subset archived',
    halo: 'One previous calendar day prefetched, excluded from requested columns' },
  algorithms: { helper: 'Actual datetime.ts getPreviousDate/formatTime/calculateSleepDuration, Map lookup instead of N+1, then agreed-rule aggregation; not old sleep-stats semantic filter.',
    candidate: 'One preparation of timestamp epoch/minute components, exact ordinal neighbour, one calendar traversal and aggregation per selected scale. Same duration semantics in process TZ.',
    aggregation: 'Arithmetic wake; bedtime hours<12 shifted +24h; independent sample counts; nap zeros for all calendar days; habit true/false/eligible counts; rounded display means only.',
    bounds: 'CPU O(R + D*H + M + P*H); aggregate storage O(R + M + P*H); daily output O(D+M). D=bounded requested calendar days, R=existing rows including one halo, H=definitions, M=marks, P=periods. No DB queries here.',
    response: 'Illustrative future payload, not accepted API: day minute values and sparse marks; aggregates means, sample counts and habit true/false/eligible/success. Same definition metadata in both payloads.' },
  limitations: ['Synthetic CPU/serialization timings do not measure PostgreSQL/HTTP/network/DOM/peak memory or production latency.',
    'Typed reconstruction starts from already decoded hypothetical scalar/mark rows; excludes database execution, scalar decode and network. Normalized wire payload may be larger. Not proof of a winning schema.',
    'JSON parse simulates pg materialization of separate sleep and habits JSONB columns, not a second parse in current services.',
    'The candidate is a research artifact, not production-safe replacement: input validation, unknown legacy identity and period/range contracts remain separate work.',
    '3653/3654-day profiles are stress inputs, not approved response limits. Partial final periods stop at synthetic today; initial date aligns every scale.',
    'No compression measured; illustrative payload field names/count exposure affect bytes. Browser cache remains bounded independently of DOM virtualization.',
    'Native Date preserves current local process-TZ duration/DST behavior. UTC clock subtraction alone would change existing duration semantics.'] }
results.validation = validate()
results.profiles = []
for (const days of results.inputs.days) for (const habits of results.inputs.habits) {
  const measured = profile(days, habits)
  results.profiles.push(measured)
  process.stdout.write(`${days}d/${habits}h: helper year=${measured.scales.year.helperPipeline.medianMs}ms, candidate=${measured.scales.year.candidatePipeline.medianMs}ms, raw=${measured.fullDailyResponse.uncompressedJsonBytes}B, year=${measured.scales.year.uncompressedJsonBytes}B\n`)
}
fs.writeFileSync(path.join(__dirname, 'storage-benchmark-results.json'), JSON.stringify(results, null, 2) + '\n')
process.stdout.write('Validation passed; storage-benchmark-results.json written.\n')

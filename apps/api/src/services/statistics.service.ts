import type { FastifyInstance } from 'fastify'
import type { ApiSchemas } from '@sadhana/api-contract'
import {
  addDays,
  blockLimits,
  calendarDate,
  nextPeriod,
  periodStart,
  type Granularity,
} from '../utils/calendar'
import { BadRequestError } from '../utils/errors'
import { habitProjection } from './habits.service'
import { sleepForDay, sleepProjection, type SleepFact } from './sleep-facts'

type StatisticsQuery = {
  granularity: Granularity
  from: string
  toExclusive: string
  asOfDate: string
  includeArchived?: boolean
  habitId?: string
}
const metric = (): ApiSchemas['SleepMetric'] => ({ value: null, sum: 0, count: 0 })
const minutes = (value: string) =>
  Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16))

export class StatisticsService {
  constructor(private fastify: FastifyInstance) {}

  async getStatistics(
    userId: string,
    query: StatisticsQuery
  ): Promise<ApiSchemas['StatisticsData']> {
    const { granularity, from, toExclusive, asOfDate } = query
    const length = (+calendarDate(toExclusive) - +calendarDate(from)) / 86400000
    calendarDate(asOfDate)
    if (
      !(granularity in blockLimits) ||
      from >= toExclusive ||
      from > asOfDate ||
      length > 1461 ||
      periodStart(from, granularity) !== from ||
      periodStart(toExclusive, granularity) !== toExclusive
    ) {
      throw new BadRequestError('Invalid or unaligned statistics range')
    }
    const starts: string[] = []
    for (let date = from; date < toExclusive; date = nextPeriod(date, granularity))
      starts.push(date)
    if (starts.length > blockLimits[granularity])
      throw new BadRequestError('Statistics block limit exceeded')
    const end = [toExclusive, addDays(asOfDate, 1)].sort()[0]
    const client = await this.fastify.pg.connect()
    try {
      const records = await client.query<SleepFact>(
        `SELECT ${sleepProjection} FROM sleep_records s WHERE s.user_id = $1 AND s.date >= $2::date AND s.date < $3::date ORDER BY s.date`,
        [userId, addDays(from, -1), end]
      )
      const definitions = await client.query<ApiSchemas['HabitDefinition']>(
        `SELECT ${habitProjection} FROM habits WHERE user_id = $1 AND ($2::boolean OR NOT archived) AND ($3::text IS NULL OR id::text = $3) ORDER BY created_at ASC NULLS FIRST, id`,
        [userId, Boolean(query.includeArchived || query.habitId), query.habitId ?? null]
      )
      const marks = await client.query<{ habit_id: string; date: string; true_count: number; false_count: number }>(
        `SELECT m.habit_id::text, date_trunc($6::text, m.date::timestamp)::date::text AS date,
         count(*) FILTER (WHERE m.value)::int AS true_count,
         count(*) FILTER (WHERE NOT m.value)::int AS false_count
         FROM habit_marks m JOIN habits h ON h.user_id = m.user_id AND h.id = m.habit_id
         WHERE m.user_id = $1 AND m.date >= $2::date AND m.date < $3::date
         AND (h.start_date IS NULL OR m.date >= h.start_date)
         AND ($4::boolean OR NOT h.archived) AND ($5::text IS NULL OR h.id::text = $5)
         GROUP BY m.habit_id, date_trunc($6::text, m.date::timestamp)::date`,
        [userId, from, end, Boolean(query.includeArchived || query.habitId), query.habitId ?? null, granularity]
      )
      const history = await client.query<{ history_from: string | null }>(
        `SELECT min(history_date)::text AS history_from FROM (
          SELECT min(date) AS history_date FROM sleep_records WHERE user_id = $1 AND date <= $2::date AND (bedtime IS NOT NULL OR wake_time IS NOT NULL OR nap_minutes > 0)
          UNION ALL SELECT min(date) FROM habit_marks WHERE user_id = $1 AND date <= $2::date
          UNION ALL SELECT min(start_date) FROM habits WHERE user_id = $1 AND start_date <= $2::date
        ) history`,
        [userId, asOfDate]
      )
      const counts = new Map<string, { trueCount: number; falseCount: number }>()
      const dayStates = new Map<string, boolean>()
      for (const mark of marks.rows) {
        const key = `${periodStart(mark.date, granularity)}:${mark.habit_id}`
        const count = counts.get(key) ?? { trueCount: 0, falseCount: 0 }
        count.trueCount += mark.true_count
        count.falseCount += mark.false_count
        counts.set(key, count)
        if (granularity === 'day') dayStates.set(`${mark.date}:${mark.habit_id}`, mark.true_count > 0)
      }
      const byDate = new Map(records.rows.map((row) => [row.date, row]))
      const columns: ApiSchemas['SleepStatisticsColumn'][] = []
      for (const start of starts) {
        if (start >= end) break
        const columnEnd = [nextPeriod(start, granularity), end].sort()[0]
        const column: ApiSchemas['SleepStatisticsColumn'] = {
          from: start,
          toExclusive: columnEnd,
          habits: definitions.rows.map((habit) => {
            const { trueCount, falseCount } = counts.get(`${start}:${habit.key}`) ?? { trueCount: 0, falseCount: 0 }
            const marked = trueCount + falseCount
            const eligibleFrom = habit.startDate ? [start, habit.startDate].sort().at(-1)! : null
            const eligibleDayCount = eligibleFrom === null ? null : Math.max(0, (+calendarDate(columnEnd) - +calendarDate(eligibleFrom)) / 86400000)
            const value: ApiSchemas['HabitStatisticsValue'] = {
              habitId: habit.key, trueCount, falseCount, eligibleDayCount,
              successRate: marked ? trueCount / marked : null,
              completeness: eligibleDayCount ? marked / eligibleDayCount : null,
            }
            if (granularity === 'day') {
              const mark = dayStates.get(`${start}:${habit.key}`)
              value.state = habit.startDate && start < habit.startDate ? 'notApplicable' : mark === true ? 'done' : mark === false ? 'failed' : 'unmarked'
            }
            return value
          }),
          bedtime: metric(),
          wakeTime: metric(),
          nap: metric(),
          duration: metric(),
        }
        for (let date = start; date < columnEnd; date = addDays(date, 1)) {
          const sleep = sleepForDay(byDate.get(date), byDate.get(addDays(date, -1)))
          if (granularity === 'day') column.source = sleep
          if (sleep.bedtime) {
            const time = minutes(sleep.bedtime)
            column.bedtime.sum += time < 720 ? time + 1440 : time
            column.bedtime.count++
          }
          if (sleep.wakeTime) {
            column.wakeTime.sum += minutes(sleep.wakeTime)
            column.wakeTime.count++
          }
          column.nap.sum += sleep.napDuration ?? 0
          column.nap.count++
          if (sleep.duration !== null) {
            column.duration.sum += sleep.duration
            column.duration.count++
          }
        }
        for (const key of ['bedtime', 'wakeTime', 'nap', 'duration'] as const) {
          const sample = column[key]
          sample.value = sample.count ? Math.round(sample.sum / sample.count) : null
          if (key === 'bedtime' && sample.value !== null) sample.value %= 1440
        }
        columns.push(column)
      }
      return {
        granularity,
        from,
        toExclusive: end,
        asOfDate,
        historyFrom: history.rows[0]?.history_from ?? asOfDate,
        habits: definitions.rows,
        columns,
      }
    } finally {
      client.release()
    }
  }
}

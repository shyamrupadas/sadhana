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
import { sleepForDay, sleepProjection, type SleepFact } from './sleep-facts'

type StatisticsQuery = {
  granularity: Granularity
  from: string
  toExclusive: string
  asOfDate: string
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
      const history = await client.query<{ history_from: string | null }>(
        `SELECT min(date)::text AS history_from FROM sleep_records WHERE user_id = $1 AND date <= $2::date AND (bedtime IS NOT NULL OR wake_time IS NOT NULL OR nap_minutes > 0)`,
        [userId, asOfDate]
      )
      const byDate = new Map(records.rows.map((row) => [row.date, row]))
      const columns: ApiSchemas['SleepStatisticsColumn'][] = []
      for (const start of starts) {
        if (start >= end) break
        const columnEnd = [nextPeriod(start, granularity), end].sort()[0]
        const column: ApiSchemas['SleepStatisticsColumn'] = {
          from: start,
          toExclusive: columnEnd,
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
        columns,
      }
    } finally {
      client.release()
    }
  }
}

import { FastifyInstance } from 'fastify'
import { ApiShemas } from '../schema'
import { SleepRecordsService } from './sleep-records.service'
import { calculateAverageTime, calculateAverageDuration } from '../utils/stats'
import { formatTime } from '../utils/datetime'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

const MOSCOW_TZ = 'Europe/Moscow'

export class SleepStatsService {
  private sleepRecordsService: SleepRecordsService

  constructor(fastify: FastifyInstance) {
    this.sleepRecordsService = new SleepRecordsService(fastify)
  }

  async getSleepStats(userId: string): Promise<ApiShemas['SleepStatsResponse']> {
    const allRecords = await this.sleepRecordsService.getAllSleepRecordsForStats(userId)

    return {
      week: this.calculatePeriodStats(allRecords, 'week'),
      month: this.calculatePeriodStats(allRecords, 'month'),
      year: this.calculatePeriodStats(allRecords, 'year'),
    }
  }

  private calculatePeriodStats(
    allRecords: ApiShemas['DailyEntry'][],
    period: 'week' | 'month' | 'year'
  ): ApiShemas['SleepStatsPeriod'] {
    const now = dayjs().tz(MOSCOW_TZ)
    let startDate: dayjs.Dayjs
    let endDate: dayjs.Dayjs = now

    switch (period) {
      case 'week':
        startDate = now.subtract(7, 'day')
        break
      case 'month':
        startDate = now.subtract(30, 'day')
        break
      case 'year':
        startDate = now.subtract(12, 'month').startOf('month')
        endDate = now.startOf('month').subtract(1, 'day')
        break
    }

    const filteredRecords = allRecords.filter((record) => {
      const recordDate = dayjs(record.date)
      return (
        (recordDate.isAfter(startDate) || recordDate.isSame(startDate, 'day')) &&
        (recordDate.isBefore(endDate) || recordDate.isSame(endDate, 'day')) &&
        record.sleep.bedtime !== null &&
        record.sleep.wakeTime !== null &&
        record.sleep.duration !== null &&
        record.sleep.duration > 0
      )
    })

    if (filteredRecords.length === 0) {
      return {
        bedtime: null,
        wakeTime: null,
        duration: null,
      }
    }

    const bedtimes = filteredRecords
      .map((r) => r.sleep.bedtime!)
      .map((bt) => formatTime(bt))
    const wakeTimes = filteredRecords
      .map((r) => r.sleep.wakeTime!)
      .map((wt) => formatTime(wt))
    const durations = filteredRecords.map((r) => r.sleep.duration!)

    return {
      bedtime: calculateAverageTime(bedtimes),
      wakeTime: calculateAverageTime(wakeTimes),
      duration: calculateAverageDuration(durations),
    }
  }
}

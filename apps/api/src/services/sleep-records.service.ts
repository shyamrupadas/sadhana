import { FastifyInstance } from 'fastify'
import { ApiShemas } from '../schema'
import { NotFoundError } from '../utils/errors'
import {
  calculateSleepDuration,
  getYesterdayMoscow,
  getMoscowDate,
  getPreviousDate,
} from '../utils/datetime'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

export class SleepRecordsService {
  constructor(private fastify: FastifyInstance) {}

  private normalizeNapDuration(napDuration: number | null | undefined): number | null {
    if (napDuration === null || napDuration === undefined) return null
    return napDuration <= 0 ? null : napDuration
  }

  async getAllSleepRecords(userId: string): Promise<ApiShemas['DailyEntry'][]> {
    const client = await this.fastify.pg.connect()

    try {
      const now = getMoscowDate()
      const fiveDaysAgo = now.subtract(4, 'day').format('YYYY-MM-DD')
      const today = now.format('YYYY-MM-DD')

      const result = await client.query(
        'SELECT id, date, sleep_data, habits FROM daily_entries WHERE user_id = $1 AND date >= $2 AND date <= $3 ORDER BY date DESC',
        [userId, fiveDaysAgo, today]
      )

      const entries: ApiShemas['DailyEntry'][] = []

      for (const row of result.rows) {
        const previousDate = getPreviousDate(row.date)
        const previousResult = await client.query(
          'SELECT sleep_data FROM daily_entries WHERE user_id = $1 AND date = $2',
          [userId, previousDate]
        )

        const previousSleepData: ApiShemas['SleepData'] =
          previousResult.rows.length > 0 && previousResult.rows[0].sleep_data
            ? previousResult.rows[0].sleep_data
            : { bedtime: null, wakeTime: null, napDuration: null, duration: null }

        const currentSleepData: ApiShemas['SleepData'] = row.sleep_data || {
          bedtime: null,
          wakeTime: null,
          napDuration: null,
          duration: null,
        }

        const duration = calculateSleepDuration(
          previousSleepData.bedtime ?? null,
          currentSleepData.wakeTime ?? null,
          currentSleepData.napDuration ?? 0
        )

        entries.push({
          id: row.date,
          date: row.date,
          sleep: {
            ...currentSleepData,
            duration,
          },
          habits: row.habits,
        })
      }

      return entries
    } finally {
      client.release()
    }
  }

  async getAllSleepRecordsForStats(userId: string): Promise<ApiShemas['DailyEntry'][]> {
    const client = await this.fastify.pg.connect()

    try {
      const result = await client.query(
        'SELECT id, date, sleep_data, habits FROM daily_entries WHERE user_id = $1 ORDER BY date DESC',
        [userId]
      )

      const entries: ApiShemas['DailyEntry'][] = []

      for (const row of result.rows) {
        const previousDate = getPreviousDate(row.date)
        const previousResult = await client.query(
          'SELECT sleep_data FROM daily_entries WHERE user_id = $1 AND date = $2',
          [userId, previousDate]
        )

        const previousSleepData: ApiShemas['SleepData'] =
          previousResult.rows.length > 0 && previousResult.rows[0].sleep_data
            ? previousResult.rows[0].sleep_data
            : { bedtime: null, wakeTime: null, napDuration: null, duration: null }

        const currentSleepData: ApiShemas['SleepData'] = row.sleep_data || {
          bedtime: null,
          wakeTime: null,
          napDuration: null,
          duration: null,
        }

        const duration = calculateSleepDuration(
          previousSleepData.bedtime ?? null,
          currentSleepData.wakeTime ?? null,
          currentSleepData.napDuration ?? 0
        )

        entries.push({
          id: row.date,
          date: row.date,
          sleep: {
            ...currentSleepData,
            duration,
          },
          habits: row.habits,
        })
      }

      return entries
    } finally {
      client.release()
    }
  }

  async getSleepRecordByDate(
    userId: string,
    date: string
  ): Promise<ApiShemas['DailyEntry'] | null> {
    const client = await this.fastify.pg.connect()

    try {
      const result = await client.query(
        'SELECT id, date, sleep_data, habits FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, date]
      )

      if (result.rows.length === 0) {
        return null
      }

      const previousDate = getPreviousDate(date)
      const previousResult = await client.query(
        'SELECT sleep_data FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, previousDate]
      )

      const previousSleepData: ApiShemas['SleepData'] =
        previousResult.rows.length > 0 && previousResult.rows[0].sleep_data
          ? previousResult.rows[0].sleep_data
          : { bedtime: null, wakeTime: null, napDuration: null, duration: null }

      const row = result.rows[0]
      const currentSleepData: ApiShemas['SleepData'] = row.sleep_data || {
        bedtime: null,
        wakeTime: null,
        napDuration: null,
        duration: null,
      }

      const duration = calculateSleepDuration(
        previousSleepData.bedtime ?? null,
        currentSleepData.wakeTime ?? null,
        currentSleepData.napDuration ?? 0
      )

      return {
        id: row.date,
        date: row.date,
        sleep: {
          ...currentSleepData,
          duration,
        },
        habits: row.habits,
      }
    } finally {
      client.release()
    }
  }

  async upsertSleepRecord(
    userId: string,
    date: string,
    sleepData: ApiShemas['SleepDataInput']
  ): Promise<ApiShemas['DailyEntry']> {
    const client = await this.fastify.pg.connect()

    try {
      await client.query('BEGIN')

      const nextDate = dayjs(date).add(1, 'day').format('YYYY-MM-DD')
      const nextRecord = await client.query(
        'SELECT sleep_data FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, nextDate]
      )

      if (
        nextRecord.rows.length > 0 &&
        sleepData.bedtime !== null &&
        sleepData.bedtime !== undefined
      ) {
        const nextSleepData: ApiShemas['SleepData'] = nextRecord.rows[0].sleep_data || {
          bedtime: null,
          wakeTime: null,
          napDuration: null,
          duration: null,
        }

        const nextDuration = calculateSleepDuration(
          sleepData.bedtime,
          nextSleepData.wakeTime ?? null,
          nextSleepData.napDuration ?? 0
        )

        const updatedNextSleepData: ApiShemas['SleepData'] = {
          ...nextSleepData,
          duration: nextDuration,
        }

        await client.query(
          `UPDATE daily_entries
           SET sleep_data = $1::jsonb, updated_at = NOW()
           WHERE user_id = $2 AND date = $3`,
          [JSON.stringify(updatedNextSleepData), userId, nextDate]
        )
      }

      const existing = await client.query(
        'SELECT sleep_data, habits FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, date]
      )

      const previousDate = getPreviousDate(date)
      const previousRecord = await client.query(
        'SELECT sleep_data FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, previousDate]
      )

      const previousSleepData: ApiShemas['SleepData'] =
        previousRecord.rows.length > 0 && previousRecord.rows[0].sleep_data
          ? previousRecord.rows[0].sleep_data
          : { bedtime: null, wakeTime: null, napDuration: null, duration: null }

      const normalizedNapDuration = this.normalizeNapDuration(sleepData.napDuration)
      const duration = calculateSleepDuration(
        previousSleepData.bedtime ?? null,
        sleepData.wakeTime ?? null,
        normalizedNapDuration
      )

      const sleepDataComplete: ApiShemas['SleepData'] = {
        bedtime: sleepData.bedtime ?? null,
        wakeTime: sleepData.wakeTime ?? null,
        napDuration: normalizedNapDuration,
        duration,
      }

      const habits =
        existing.rows.length > 0 && Array.isArray(existing.rows[0].habits)
          ? existing.rows[0].habits
          : []

      const entryId = `${userId}-${date}`
      const result = await client.query(
        `INSERT INTO daily_entries (id, user_id, date, sleep_data, habits)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
         ON CONFLICT (user_id, date)
         DO UPDATE SET sleep_data = $4::jsonb, updated_at = NOW()
         RETURNING id, date, sleep_data, habits`,
        [entryId, userId, date, JSON.stringify(sleepDataComplete), JSON.stringify(habits)]
      )

      await client.query('COMMIT')

      const row = result.rows[0]
      const finalSleepData: ApiShemas['SleepData'] = row.sleep_data

      const finalPreviousRecord = await client.query(
        'SELECT sleep_data FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, previousDate]
      )

      const finalPreviousSleepData: ApiShemas['SleepData'] =
        finalPreviousRecord.rows.length > 0 && finalPreviousRecord.rows[0].sleep_data
          ? finalPreviousRecord.rows[0].sleep_data
          : { bedtime: null, wakeTime: null, napDuration: null, duration: null }

      const recalculatedDuration = calculateSleepDuration(
        finalPreviousSleepData.bedtime ?? null,
        finalSleepData.wakeTime ?? null,
        finalSleepData.napDuration ?? 0
      )

      return {
        id: row.date,
        date: row.date,
        sleep: {
          ...finalSleepData,
          duration: recalculatedDuration,
        },
        habits: row.habits,
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async updateHabitValue(
    userId: string,
    date: string,
    habitKey: string,
    value: boolean
  ): Promise<ApiShemas['DailyEntry']> {
    const client = await this.fastify.pg.connect()

    try {
      const existing = await client.query(
        'SELECT sleep_data, habits FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, date]
      )

      let sleepData: ApiShemas['SleepData']
      let habits: ApiShemas['HabitCheck'][]

      if (existing.rows.length === 0) {
        sleepData = {
          bedtime: null,
          wakeTime: null,
          napDuration: null,
          duration: null,
        }
        habits = []
      } else {
        const row = existing.rows[0]
        sleepData = row.sleep_data || {
          bedtime: null,
          wakeTime: null,
          napDuration: null,
          duration: null,
        }
        habits = Array.isArray(row.habits) ? row.habits : []
      }

      const habitIndex = habits.findIndex((h) => h.key === habitKey)

      if (habitIndex >= 0) {
        habits[habitIndex].value = value
      } else {
        habits.push({ key: habitKey, value })
      }

      const previousDate = getPreviousDate(date)
      const previousResult = await client.query(
        'SELECT sleep_data FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, previousDate]
      )

      const previousSleepData: ApiShemas['SleepData'] =
        previousResult.rows.length > 0 && previousResult.rows[0].sleep_data
          ? previousResult.rows[0].sleep_data
          : { bedtime: null, wakeTime: null, napDuration: null, duration: null }

      const duration = calculateSleepDuration(
        previousSleepData.bedtime ?? null,
        sleepData.wakeTime ?? null,
        sleepData.napDuration ?? 0
      )

      const updatedSleepData: ApiShemas['SleepData'] = {
        ...sleepData,
        duration,
      }

      const entryId = `${userId}-${date}`
      const result = await client.query(
        `INSERT INTO daily_entries (id, user_id, date, sleep_data, habits)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
         ON CONFLICT (user_id, date)
         DO UPDATE SET habits = $5::jsonb, sleep_data = $4::jsonb, updated_at = NOW()
         RETURNING id, date, sleep_data, habits`,
        [entryId, userId, date, JSON.stringify(updatedSleepData), JSON.stringify(habits)]
      )

      const row = result.rows[0]
      const finalSleepData: ApiShemas['SleepData'] = row.sleep_data || updatedSleepData

      const finalPreviousResult = await client.query(
        'SELECT sleep_data FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, previousDate]
      )

      const finalPreviousSleepData: ApiShemas['SleepData'] =
        finalPreviousResult.rows.length > 0 && finalPreviousResult.rows[0].sleep_data
          ? finalPreviousResult.rows[0].sleep_data
          : { bedtime: null, wakeTime: null, napDuration: null, duration: null }

      const recalculatedDuration = calculateSleepDuration(
        finalPreviousSleepData.bedtime ?? null,
        finalSleepData.wakeTime ?? null,
        finalSleepData.napDuration ?? 0
      )

      return {
        id: row.date,
        date: row.date,
        sleep: {
          ...finalSleepData,
          duration: recalculatedDuration,
        },
        habits: row.habits,
      }
    } finally {
      client.release()
    }
  }

  async removeHabitFromDay(
    userId: string,
    date: string,
    habitKey: string
  ): Promise<ApiShemas['DailyEntry']> {
    const client = await this.fastify.pg.connect()

    try {
      const existing = await client.query(
        'SELECT sleep_data, habits FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, date]
      )

      if (existing.rows.length === 0) {
        throw new NotFoundError('Daily entry not found')
      }

      const habits: ApiShemas['HabitCheck'][] = existing.rows[0].habits.filter(
        (h: ApiShemas['HabitCheck']) => h.key !== habitKey
      )

      const sleepData: ApiShemas['SleepData'] = existing.rows[0].sleep_data || {
        bedtime: null,
        wakeTime: null,
        napDuration: null,
        duration: null,
      }

      const previousDate = getPreviousDate(date)
      const previousResult = await client.query(
        'SELECT sleep_data FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, previousDate]
      )

      const previousSleepData: ApiShemas['SleepData'] =
        previousResult.rows.length > 0 && previousResult.rows[0].sleep_data
          ? previousResult.rows[0].sleep_data
          : { bedtime: null, wakeTime: null, napDuration: null, duration: null }

      const duration = calculateSleepDuration(
        previousSleepData.bedtime ?? null,
        sleepData.wakeTime ?? null,
        sleepData.napDuration ?? 0
      )

      const updatedSleepData: ApiShemas['SleepData'] = {
        ...sleepData,
        duration,
      }

      const result = await client.query(
        `UPDATE daily_entries
         SET habits = $1::jsonb, sleep_data = $2::jsonb, updated_at = NOW()
         WHERE user_id = $3 AND date = $4
         RETURNING id, date, sleep_data, habits`,
        [JSON.stringify(habits), JSON.stringify(updatedSleepData), userId, date]
      )

      const row = result.rows[0]
      const finalSleepData: ApiShemas['SleepData'] = row.sleep_data || updatedSleepData

      const finalPreviousResult = await client.query(
        'SELECT sleep_data FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, previousDate]
      )

      const finalPreviousSleepData: ApiShemas['SleepData'] =
        finalPreviousResult.rows.length > 0 && finalPreviousResult.rows[0].sleep_data
          ? finalPreviousResult.rows[0].sleep_data
          : { bedtime: null, wakeTime: null, napDuration: null, duration: null }

      const recalculatedDuration = calculateSleepDuration(
        finalPreviousSleepData.bedtime ?? null,
        finalSleepData.wakeTime ?? null,
        finalSleepData.napDuration ?? 0
      )

      return {
        id: row.date,
        date: row.date,
        sleep: {
          ...finalSleepData,
          duration: recalculatedDuration,
        },
        habits: row.habits,
      }
    } finally {
      client.release()
    }
  }

  async checkYesterdayData(userId: string): Promise<boolean> {
    const client = await this.fastify.pg.connect()

    try {
      const yesterday = getYesterdayMoscow()
      const dayBeforeYesterday = getPreviousDate(yesterday)

      const yesterdayResult = await client.query(
        'SELECT sleep_data FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, yesterday]
      )

      if (yesterdayResult.rows.length === 0) {
        return false
      }

      const yesterdaySleepData: ApiShemas['SleepData'] =
        yesterdayResult.rows[0].sleep_data

      const dayBeforeYesterdayResult = await client.query(
        'SELECT sleep_data FROM daily_entries WHERE user_id = $1 AND date = $2',
        [userId, dayBeforeYesterday]
      )

      const dayBeforeYesterdaySleepData: ApiShemas['SleepData'] =
        dayBeforeYesterdayResult.rows.length > 0 &&
        dayBeforeYesterdayResult.rows[0].sleep_data
          ? dayBeforeYesterdayResult.rows[0].sleep_data
          : { bedtime: null, wakeTime: null, napDuration: null, duration: null }

      return (
        dayBeforeYesterdaySleepData.bedtime !== null &&
        dayBeforeYesterdaySleepData.bedtime !== undefined &&
        yesterdaySleepData.wakeTime !== null &&
        yesterdaySleepData.wakeTime !== undefined
      )
    } finally {
      client.release()
    }
  }
}

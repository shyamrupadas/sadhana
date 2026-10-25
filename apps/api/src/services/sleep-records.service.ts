import type { FastifyInstance } from 'fastify'
import type { ApiSchemas } from '@sadhana/api-contract'
import { BadRequestError, NotFoundError } from '../utils/errors'
import { getMoscowDate, getYesterdayMoscow } from '../utils/datetime'
import { addDays, calendarDate } from '../utils/calendar'
import { sleepForDay, sleepProjection, type SleepFact } from './sleep-facts'

type EntryRow = SleepFact & { habits: ApiSchemas['HabitCheck'][] }

export class SleepRecordsService {
  constructor(private fastify: FastifyInstance) {}

  private async readRange(
    userId: string,
    from: string,
    to: string
  ): Promise<ApiSchemas['DailyEntry'][]> {
    const client = await this.fastify.pg.connect()
    try {
      const result = await client.query<EntryRow>(
        `SELECT d.date AS entry_date, d.habits, ${sleepProjection}
        FROM daily_entries d LEFT JOIN sleep_records s ON s.user_id = d.user_id AND s.date = d.date::date
        WHERE d.user_id = $1 AND d.date >= $2 AND d.date <= $3 ORDER BY d.date DESC`,
        [userId, addDays(from, -1), to]
      )
      // Empty sleep rows still belong to their daily entry.
      const rows = result.rows as (EntryRow & { entry_date: string })[]
      const byDate = new Map(rows.map((row) => [row.entry_date, row]))
      return rows
        .filter((row) => row.entry_date >= from)
        .map((row) => ({
          id: row.entry_date,
          date: row.entry_date,
          habits: row.habits,
          sleep: sleepForDay(row, byDate.get(addDays(row.entry_date, -1))),
        }))
    } finally {
      client.release()
    }
  }

  async getAllSleepRecords(userId: string): Promise<ApiSchemas['DailyEntry'][]> {
    const today = getMoscowDate().format('YYYY-MM-DD')
    return this.readRange(userId, addDays(today, -4), today)
  }

  async getSleepRecordByDate(
    userId: string,
    date: string
  ): Promise<ApiSchemas['DailyEntry'] | null> {
    calendarDate(date)
    return (await this.readRange(userId, date, date))[0] ?? null
  }

  async upsertSleepRecord(
    userId: string,
    date: string,
    input: ApiSchemas['SleepDataInput']
  ): Promise<ApiSchemas['DailyEntry']> {
    calendarDate(date)
    for (const value of [input.bedtime, input.wakeTime]) {
      if (value == null) continue
      calendarDate(value.slice(0, 10))
      if (!/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(value))
        throw new BadRequestError('Invalid local sleep time')
    }
    const client = await this.fastify.pg.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO daily_entries (id, user_id, date) VALUES ($1, $2, $3) ON CONFLICT (user_id, date) DO NOTHING`,
        [`${userId}-${date}`, userId, date]
      )
      await client.query(
        `INSERT INTO sleep_records (user_id, date, bedtime, wake_time, nap_minutes)
        VALUES ($1, $2::date, $3::timestamp, $4::timestamp, $5)
        ON CONFLICT (user_id, date) DO UPDATE SET bedtime = EXCLUDED.bedtime, wake_time = EXCLUDED.wake_time, nap_minutes = EXCLUDED.nap_minutes`,
        [userId, date, input.bedtime ?? null, input.wakeTime ?? null, input.napDuration]
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    return (await this.getSleepRecordByDate(userId, date))!
  }

  async updateHabitValue(
    userId: string,
    date: string,
    habitKey: string,
    value: boolean
  ): Promise<ApiSchemas['DailyEntry']> {
    calendarDate(date)
    const client = await this.fastify.pg.connect()
    try {
      // Only mutate the habits field. Concurrent sleep writes cannot overwrite marks.
      await client.query(
        `INSERT INTO daily_entries (id, user_id, date, habits) VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (user_id, date) DO UPDATE SET habits =
          COALESCE((SELECT jsonb_agg(mark) FROM jsonb_array_elements(daily_entries.habits) mark WHERE mark->>'key' <> $5), '[]'::jsonb) || $4::jsonb,
          updated_at = NOW()`,
        [
          `${userId}-${date}`,
          userId,
          date,
          JSON.stringify([{ key: habitKey, value }]),
          habitKey,
        ]
      )
    } finally {
      client.release()
    }
    return (await this.getSleepRecordByDate(userId, date))!
  }

  async removeHabitFromDay(
    userId: string,
    date: string,
    habitKey: string
  ): Promise<ApiSchemas['DailyEntry']> {
    calendarDate(date)
    const client = await this.fastify.pg.connect()
    try {
      const result = await client.query(
        `UPDATE daily_entries SET habits = COALESCE(
        (SELECT jsonb_agg(mark) FROM jsonb_array_elements(habits) mark WHERE mark->>'key' <> $3), '[]'::jsonb), updated_at = NOW()
        WHERE user_id = $1 AND date = $2 RETURNING date`,
        [userId, date, habitKey]
      )
      if (!result.rowCount) throw new NotFoundError('Daily entry not found')
    } finally {
      client.release()
    }
    return (await this.getSleepRecordByDate(userId, date))!
  }

  async checkYesterdayData(userId: string): Promise<boolean> {
    const yesterday = getYesterdayMoscow()
    const entries = await this.readRange(userId, addDays(yesterday, -1), yesterday)
    return Boolean(
      entries.find((row) => row.date === yesterday)?.sleep.wakeTime &&
      entries.find((row) => row.date === addDays(yesterday, -1))?.sleep.bedtime
    )
  }
}

import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { ApiSchemas } from '@sadhana/api-contract'
import { BadRequestError, NotFoundError } from '../utils/errors'
import { calendarDate } from '../utils/calendar'

export const habitProjection = `id::text AS key, label,
  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "createdAt",
  start_date::text AS "startDate", archived`

export class HabitsService {
  constructor(private fastify: FastifyInstance) {}

  async getAllHabits(userId: string): Promise<ApiSchemas['HabitDefinition'][]> {
    const result = await this.fastify.pg.query(
      `SELECT ${habitProjection} FROM habits WHERE user_id = $1 ORDER BY created_at ASC NULLS FIRST, id`,
      [userId]
    )
    return result.rows
  }

  async createHabit(userId: string, input: ApiSchemas['HabitCreateInput']): Promise<ApiSchemas['HabitDefinition']> {
    calendarDate(input.creationDate)
    if (!input.label.trim()) throw new BadRequestError('Habit label is empty')
    const result = await this.fastify.pg.query(
      `INSERT INTO habits (id, user_id, label, start_date) VALUES ($1, $2, $3, $4::date) RETURNING ${habitProjection}`,
      [randomUUID(), userId, input.label.trim(), input.creationDate]
    )
    return result.rows[0]
  }

  async updateHabit(userId: string, key: string, label: string): Promise<ApiSchemas['HabitDefinition']> {
    if (!label.trim()) throw new BadRequestError('Habit label is empty')
    const result = await this.fastify.pg.query(
      `UPDATE habits SET label = $1 WHERE user_id = $2 AND id::text = $3 RETURNING ${habitProjection}`,
      [label.trim(), userId, key]
    )
    if (!result.rows.length) throw new NotFoundError('Habit not found')
    return result.rows[0]
  }

  async setArchived(userId: string, key: string, archived: boolean): Promise<ApiSchemas['HabitDefinition']> {
    const result = await this.fastify.pg.query(
      `UPDATE habits SET archived = $1 WHERE user_id = $2 AND id::text = $3 RETURNING ${habitProjection}`,
      [archived, userId, key]
    )
    if (!result.rows.length) throw new NotFoundError('Habit not found')
    return result.rows[0]
  }

  async getDeletionSummary(userId: string, key: string): Promise<ApiSchemas['HabitDeletionSummary']> {
    const result = await this.fastify.pg.query(
      `SELECT h.id::text AS key, h.label, count(m.habit_id)::int AS "markCount"
       FROM habits h LEFT JOIN habit_marks m ON m.user_id = h.user_id AND m.habit_id = h.id
       WHERE h.user_id = $1 AND h.id::text = $2 GROUP BY h.id`,
      [userId, key]
    )
    if (!result.rows.length) throw new NotFoundError('Habit not found')
    return result.rows[0]
  }

  async deleteHabit(userId: string, key: string): Promise<void> {
    // The composite FK cascades all marks in this statement, including concurrent commits.
    const result = await this.fastify.pg.query(
      'DELETE FROM habits WHERE user_id = $1 AND id::text = $2', [userId, key]
    )
    if (!result.rowCount) throw new NotFoundError('Habit not found')
  }
}

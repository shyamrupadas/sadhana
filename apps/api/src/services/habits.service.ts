import { FastifyInstance } from 'fastify'
import { ApiShemas } from '../schema'
import { NotFoundError } from '../utils/errors'
import { generateHabitKey } from '../utils/habit-key'

export class HabitsService {
  constructor(private fastify: FastifyInstance) {}

  async getAllHabits(userId: string): Promise<ApiShemas['HabitDefinition'][]> {
    const client = await this.fastify.pg.connect()

    try {
      const result = await client.query(
        'SELECT key, label, created_at FROM habits WHERE user_id = $1 ORDER BY created_at ASC',
        [userId]
      )

      return result.rows.map((row) => ({
        key: row.key,
        label: row.label,
        createdAt: row.created_at.toISOString(),
      }))
    } finally {
      client.release()
    }
  }

  async createHabit(
    userId: string,
    label: string
  ): Promise<ApiShemas['HabitDefinition']> {
    const client = await this.fastify.pg.connect()

    try {
      const key = generateHabitKey(label)

      const existing = await client.query(
        'SELECT key, label, created_at FROM habits WHERE user_id = $1 AND key = $2',
        [userId, key]
      )

      if (existing.rows.length > 0) {
        return {
          key: existing.rows[0].key,
          label: existing.rows[0].label,
          createdAt: existing.rows[0].created_at.toISOString(),
        }
      }

      const result = await client.query(
        'INSERT INTO habits (user_id, key, label) VALUES ($1, $2, $3) RETURNING key, label, created_at',
        [userId, key, label]
      )

      const row = result.rows[0]
      return {
        key: row.key,
        label: row.label,
        createdAt: row.created_at.toISOString(),
      }
    } finally {
      client.release()
    }
  }

  async updateHabit(
    userId: string,
    key: string,
    label: string
  ): Promise<ApiShemas['HabitDefinition']> {
    const client = await this.fastify.pg.connect()

    try {
      const result = await client.query(
        'UPDATE habits SET label = $1 WHERE user_id = $2 AND key = $3 RETURNING key, label, created_at',
        [label, userId, key]
      )

      if (result.rows.length === 0) {
        throw new NotFoundError('Habit not found')
      }

      const row = result.rows[0]
      return {
        key: row.key,
        label: row.label,
        createdAt: row.created_at.toISOString(),
      }
    } finally {
      client.release()
    }
  }

  async deleteHabit(userId: string, key: string): Promise<void> {
    const client = await this.fastify.pg.connect()

    try {
      const result = await client.query(
        'DELETE FROM habits WHERE user_id = $1 AND key = $2',
        [userId, key]
      )

      if (result.rowCount === 0) {
        throw new NotFoundError('Habit not found')
      }
    } finally {
      client.release()
    }
  }

  async getHabitByKey(
    userId: string,
    key: string
  ): Promise<ApiShemas['HabitDefinition'] | null> {
    const client = await this.fastify.pg.connect()

    try {
      const result = await client.query(
        'SELECT key, label, created_at FROM habits WHERE user_id = $1 AND key = $2',
        [userId, key]
      )

      if (result.rows.length === 0) {
        return null
      }

      const row = result.rows[0]
      return {
        key: row.key,
        label: row.label,
        createdAt: row.created_at.toISOString(),
      }
    } finally {
      client.release()
    }
  }
}

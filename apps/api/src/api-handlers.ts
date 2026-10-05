import type { FastifyInstance } from 'fastify'
import type {} from './types/fastify'
import type { ApiHandlers } from '@sadhana/api-contract'
import { AuthService } from './services/auth.service'
import { HabitsService } from './services/habits.service'
import { SleepRecordsService } from './services/sleep-records.service'
import { SleepStatsService } from './services/sleep-stats.service'

const buildRefreshCookieOptions = (isHttps: boolean) => {
  // NOTE: Behind a proxy (Railway), HTTPS is usually indicated via x-forwarded-proto.
  const sameSite: 'none' | 'lax' = isHttps ? 'none' : 'lax'
  const secure = isHttps

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  } as const
}

export function createApiHandlers(fastify: FastifyInstance): ApiHandlers {
  const authService = new AuthService(fastify)
  const habitsService = new HabitsService(fastify)
  const sleepRecordsService = new SleepRecordsService(fastify)
  const sleepStatsService = new SleepStatsService(fastify)

  return {
    async register({ body, isHttps }) {
      const result = await authService.register(body.email, body.password)
      const token = await authService.generateRefreshTokenForUser(result.user.id)
      return {
        status: 201,
        body: result,
        headers: { 'Set-Cookie': fastify.serializeCookie('refreshToken', token, buildRefreshCookieOptions(isHttps)) },
      }
    },
    async login({ body, isHttps }) {
      const result = await authService.login(body.email, body.password)
      const token = await authService.generateRefreshTokenForUser(result.user.id)
      return {
        status: 200,
        body: result,
        headers: { 'Set-Cookie': fastify.serializeCookie('refreshToken', token, buildRefreshCookieOptions(isHttps)) },
      }
    },
    async refresh({ refreshToken, isHttps }) {
      if (!refreshToken) {
        return { status: 401, body: { message: 'Refresh token not found', code: 'UNAUTHORIZED' } }
      }
      const result = await authService.refreshAccessToken(refreshToken)
      const token = await authService.generateRefreshTokenForUser(result.user.id)
      return {
        status: 200,
        body: result,
        headers: { 'Set-Cookie': fastify.serializeCookie('refreshToken', token, buildRefreshCookieOptions(isHttps)) },
      }
    },
    async getHabits({ user }) {
      return { status: 200, body: await habitsService.getAllHabits(user.id) }
    },
    async createHabit({ user, body }) {
      return { status: 201, body: await habitsService.createHabit(user.id, body.label) }
    },
    async updateHabit({ user, key, body }) {
      return { status: 200, body: await habitsService.updateHabit(user.id, key, body.label) }
    },
    async deleteHabit({ user, key }) {
      await habitsService.deleteHabit(user.id, key)
      return { status: 204 }
    },
    async getSleepRecords({ user }) {
      return { status: 200, body: await sleepRecordsService.getAllSleepRecords(user.id) }
    },
    async getSleepRecord({ user, date }) {
      const record = await sleepRecordsService.getSleepRecordByDate(user.id, date)
      return record
        ? { status: 200, body: record }
        : { status: 404, body: { message: 'Sleep record not found', code: 'NOT_FOUND' } }
    },
    async putSleepRecord({ user, date, body }) {
      return { status: 200, body: await sleepRecordsService.upsertSleepRecord(user.id, date, {
        bedtime: body.bedtime ?? null,
        wakeTime: body.wakeTime ?? null,
        napDuration: body.napDuration,
      }) }
    },
    async setDailyHabitMark({ user, date, habitKey, body }) {
      return { status: 200, body: await sleepRecordsService.updateHabitValue(user.id, date, habitKey, body.value) }
    },
    async removeDailyHabitMark({ user, date, habitKey }) {
      return { status: 200, body: await sleepRecordsService.removeHabitFromDay(user.id, date, habitKey) }
    },
    async checkYesterday({ user }) {
      return { status: 200, body: { hasData: await sleepRecordsService.checkYesterdayData(user.id) } }
    },
    async getSleepStats({ user }) {
      return { status: 200, body: await sleepStatsService.getSleepStats(user.id) }
    },
  }
}

import { FastifyPluginAsync } from 'fastify'
import type { ApiHandlers } from '@sadhana/api-contract'
import { SleepRecordsService } from '../../services/sleep-records.service'
import { ApiShemas } from '../../schema'
import { AppError } from '../../utils/errors'
import { authenticate } from '../../middleware/auth'

const sleepRecordsRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  const sleepRecordsService = new SleepRecordsService(fastify)
  const handlers: Pick<ApiHandlers, 'getSleepRecords' | 'getSleepRecord' | 'putSleepRecord' | 'setDailyHabitMark' | 'removeDailyHabitMark'> = {
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
  }

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(error.toJSON())
    }

    const err = error instanceof Error ? error : new Error(String(error))
    fastify.log.error({
      err: error,
      message: err.message,
      stack: err.stack,
      url: request.url,
      method: request.method,
    })
    return reply.code(500).send({
      message: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
    })
  })

  fastify.get<{
    Reply: ApiShemas['DailyEntry'][] | ApiShemas['Error']
  }>(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
                date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
                sleep: {
                  type: 'object',
                  properties: {
                    bedtime: {
                      type: ['string', 'null'],
                      pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
                    },
                    wakeTime: {
                      type: ['string', 'null'],
                      pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
                    },
                    napDuration: { type: ['integer', 'null'], minimum: 0 },
                    duration: { type: ['integer', 'null'], minimum: 0 },
                  },
                  required: ['bedtime', 'wakeTime', 'napDuration', 'duration'],
                },
                habits: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      key: { type: 'string' },
                      value: { type: 'boolean' },
                    },
                    required: ['key', 'value'],
                  },
                },
              },
              required: ['id', 'date', 'sleep', 'habits'],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await handlers.getSleepRecords({ user: request.user! })
      return reply.code(result.status).send(result.body)
    }
  )

  fastify.get<{
    Params: { date: string }
    Reply: ApiShemas['DailyEntry'] | ApiShemas['Error']
  }>(
    '/:date',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          properties: {
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
          required: ['date'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              sleep: {
                type: 'object',
                properties: {
                  bedtime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
                  },
                  wakeTime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
                  },
                  napDuration: { type: ['integer', 'null'], minimum: 0 },
                  duration: { type: ['integer', 'null'], minimum: 0 },
                },
                required: ['bedtime', 'wakeTime', 'napDuration', 'duration'],
              },
              habits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string' },
                    value: { type: 'boolean' },
                  },
                  required: ['key', 'value'],
                },
              },
            },
            required: ['id', 'date', 'sleep', 'habits'],
          },
          404: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              code: { type: 'string' },
            },
            required: ['message', 'code'],
          },
        },
      },
    },
    async (request, reply) => {
      const result = await handlers.getSleepRecord({ user: request.user!, date: request.params.date })
      return reply.code(result.status).send(result.body)
    }
  )

  fastify.put<{
    Params: { date: string }
    Body: ApiShemas['SleepDataInput']
    Reply: ApiShemas['DailyEntry'] | ApiShemas['Error']
  }>(
    '/:date',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          properties: {
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
          required: ['date'],
        },
        body: {
          type: 'object',
          required: ['napDuration'],
          properties: {
            bedtime: {
              type: ['string', 'null'],
              pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
            },
            wakeTime: {
              type: ['string', 'null'],
              pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
            },
            napDuration: { type: ['integer', 'null'], minimum: 0 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              sleep: {
                type: 'object',
                properties: {
                  bedtime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
                  },
                  wakeTime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
                  },
                  napDuration: { type: ['integer', 'null'], minimum: 0 },
                  duration: { type: ['integer', 'null'], minimum: 0 },
                },
                required: ['bedtime', 'wakeTime', 'napDuration', 'duration'],
              },
              habits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string' },
                    value: { type: 'boolean' },
                  },
                  required: ['key', 'value'],
                },
              },
            },
            required: ['id', 'date', 'sleep', 'habits'],
          },
        },
      },
    },
    async (request, reply) => {
      const result = await handlers.putSleepRecord({ user: request.user!, date: request.params.date, body: request.body })
      return reply.code(result.status).send(result.body)
    }
  )

  fastify.patch<{
    Params: { date: string; habitKey: string }
    Body: ApiShemas['UpdateHabitValueRequest']
    Reply: ApiShemas['DailyEntry'] | ApiShemas['Error']
  }>(
    '/:date/habits/:habitKey',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          properties: {
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            habitKey: { type: 'string' },
          },
          required: ['date', 'habitKey'],
        },
        body: {
          type: 'object',
          required: ['value'],
          properties: {
            value: { type: 'boolean' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              sleep: {
                type: 'object',
                properties: {
                  bedtime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
                  },
                  wakeTime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
                  },
                  napDuration: { type: ['integer', 'null'], minimum: 0 },
                  duration: { type: ['integer', 'null'], minimum: 0 },
                },
                required: ['bedtime', 'wakeTime', 'napDuration', 'duration'],
              },
              habits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string' },
                    value: { type: 'boolean' },
                  },
                  required: ['key', 'value'],
                },
              },
            },
            required: ['id', 'date', 'sleep', 'habits'],
          },
        },
      },
    },
    async (request, reply) => {
      const result = await handlers.setDailyHabitMark({ user: request.user!, date: request.params.date, habitKey: request.params.habitKey, body: request.body })
      return reply.code(result.status).send(result.body)
    }
  )

  fastify.delete<{
    Params: { date: string; habitKey: string }
    Reply: ApiShemas['DailyEntry'] | ApiShemas['Error']
  }>(
    '/:date/habits/:habitKey',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          properties: {
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            habitKey: { type: 'string' },
          },
          required: ['date', 'habitKey'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              sleep: {
                type: 'object',
                properties: {
                  bedtime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
                  },
                  wakeTime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
                  },
                  napDuration: { type: ['integer', 'null'], minimum: 0 },
                  duration: { type: ['integer', 'null'], minimum: 0 },
                },
                required: ['bedtime', 'wakeTime', 'napDuration', 'duration'],
              },
              habits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string' },
                    value: { type: 'boolean' },
                  },
                  required: ['key', 'value'],
                },
              },
            },
            required: ['id', 'date', 'sleep', 'habits'],
          },
        },
      },
    },
    async (request, reply) => {
      const result = await handlers.removeDailyHabitMark({ user: request.user!, date: request.params.date, habitKey: request.params.habitKey })
      return reply.code(result.status).send(result.body)
    }
  )

  fastify.get<{
    Reply: ApiShemas['CheckYesterdayResponse']
  }>(
    '/yesterday/check',
    {
      preHandler: [authenticate],
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              hasData: { type: 'boolean' },
            },
            required: ['hasData'],
          },
        },
      },
    },
    async (request, reply) => {
      const hasData = await sleepRecordsService.checkYesterdayData(request.user!.id)
      return reply.send({ hasData })
    }
  )
}

export default sleepRecordsRoutes

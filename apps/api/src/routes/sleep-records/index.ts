import { FastifyPluginAsync } from 'fastify'
import type { ApiSchemas } from '@sadhana/api-contract'
import { AppError } from '../../utils/errors'
import { authenticate } from '../../middleware/auth'

const sleepRecordsRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  const handlers = fastify.apiHandlers

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
    Reply: ApiSchemas['DailyEntry'][] | ApiSchemas['ApiError']
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
    Reply: ApiSchemas['DailyEntry'] | ApiSchemas['ApiError']
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
    Body: ApiSchemas['SleepDataInput']
    Reply: ApiSchemas['DailyEntry'] | ApiSchemas['ApiError']
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
    Body: ApiSchemas['DailyHabitMarkInput']
    Reply: ApiSchemas['DailyEntry'] | ApiSchemas['ApiError']
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
    Reply: ApiSchemas['DailyEntry'] | ApiSchemas['ApiError']
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
    Reply: ApiSchemas['CheckYesterdayData'] | ApiSchemas['ApiError']
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
      const result = await handlers.checkYesterday({ user: request.user! })
      return reply.code(result.status).send(result.body)
    }
  )
}

export default sleepRecordsRoutes

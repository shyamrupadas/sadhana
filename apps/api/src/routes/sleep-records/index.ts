import { FastifyPluginAsync } from 'fastify'
import { SleepRecordsService } from '../../services/sleep-records.service'
import { ApiShemas } from '../../schema'
import { AppError } from '../../utils/errors'
import { authenticate } from '../../middleware/auth'

const sleepRecordsRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  const sleepRecordsService = new SleepRecordsService(fastify)

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
    Reply: ApiShemas['DailyEntry'][]
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
      const records = await sleepRecordsService.getAllSleepRecords(request.user!.id)
      return reply.send(records)
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
      const record = await sleepRecordsService.getSleepRecordByDate(
        request.user!.id,
        request.params.date
      )

      if (!record) {
        const error: ApiShemas['Error'] = {
          message: 'Sleep record not found',
          code: 'NOT_FOUND',
        }
        return reply.code(404).send(error)
      }

      return reply.send(record)
    }
  )

  fastify.put<{
    Params: { date: string }
    Body: ApiShemas['SleepDataInput']
    Reply: ApiShemas['DailyEntry']
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
      const record = await sleepRecordsService.upsertSleepRecord(
        request.user!.id,
        request.params.date,
        request.body
      )
      return reply.send(record)
    }
  )

  fastify.patch<{
    Params: { date: string; habitKey: string }
    Body: ApiShemas['UpdateHabitValueRequest']
    Reply: ApiShemas['DailyEntry']
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
      const record = await sleepRecordsService.updateHabitValue(
        request.user!.id,
        request.params.date,
        request.params.habitKey,
        request.body.value
      )
      return reply.send(record)
    }
  )

  fastify.delete<{
    Params: { date: string; habitKey: string }
    Reply: ApiShemas['DailyEntry']
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
      const record = await sleepRecordsService.removeHabitFromDay(
        request.user!.id,
        request.params.date,
        request.params.habitKey
      )
      return reply.send(record)
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

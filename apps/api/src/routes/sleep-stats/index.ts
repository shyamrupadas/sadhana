import { FastifyPluginAsync } from 'fastify'
import { SleepStatsService } from '../../services/sleep-stats.service'
import { ApiShemas } from '../../schema'
import { AppError } from '../../utils/errors'
import { authenticate } from '../../middleware/auth'

const sleepStatsRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  const sleepStatsService = new SleepStatsService(fastify)

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(error.toJSON())
    }

    fastify.log.error(error)
    return reply.code(500).send({
      message: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
    })
  })

  fastify.get<{
    Reply: ApiShemas['SleepStatsResponse']
  }>(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              week: {
                type: 'object',
                properties: {
                  bedtime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{2}:\\d{2}$',
                  },
                  wakeTime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{2}:\\d{2}$',
                  },
                  duration: {
                    type: ['string', 'null'],
                    pattern: '^\\d+:\\d{2}$',
                  },
                },
                required: ['bedtime', 'wakeTime', 'duration'],
              },
              month: {
                type: 'object',
                properties: {
                  bedtime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{2}:\\d{2}$',
                  },
                  wakeTime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{2}:\\d{2}$',
                  },
                  duration: {
                    type: ['string', 'null'],
                    pattern: '^\\d+:\\d{2}$',
                  },
                },
                required: ['bedtime', 'wakeTime', 'duration'],
              },
              year: {
                type: 'object',
                properties: {
                  bedtime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{2}:\\d{2}$',
                  },
                  wakeTime: {
                    type: ['string', 'null'],
                    pattern: '^\\d{2}:\\d{2}$',
                  },
                  duration: {
                    type: ['string', 'null'],
                    pattern: '^\\d+:\\d{2}$',
                  },
                },
                required: ['bedtime', 'wakeTime', 'duration'],
              },
            },
            required: ['week', 'month', 'year'],
          },
        },
      },
    },
    async (request, reply) => {
      const stats = await sleepStatsService.getSleepStats(request.user!.id)
      return reply.send(stats)
    }
  )
}

export default sleepStatsRoutes

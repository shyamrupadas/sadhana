import type { FastifyPluginAsync } from 'fastify'
import type { ApiSchemas } from '@sadhana/api-contract'
import { authenticate } from '../../middleware/auth'
import { AppError, BadRequestError } from '../../utils/errors'

type Query = {
  granularity: 'day' | 'week' | 'month' | 'year'
  from: string
  toExclusive: string
  asOfDate: string
}

const statisticsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError)
      return reply.code(error.statusCode).send(error.toJSON())
    if (error instanceof Error && 'validation' in error)
      return reply.code(400).send(new BadRequestError(error.message).toJSON())
    fastify.log.error(error)
    return reply
      .code(500)
      .send({ code: 'INTERNAL_ERROR', message: 'Internal Server Error' })
  })
  fastify.get<{
    Querystring: Query
    Reply: ApiSchemas['StatisticsData'] | ApiSchemas['ApiError']
  }>(
    '/',
    {
      onRequest: [authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['granularity', 'from', 'toExclusive', 'asOfDate'],
          properties: {
            granularity: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
            from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            toExclusive: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            asOfDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await fastify.apiHandlers.getStatistics({
        user: request.user!,
        query: request.query,
      })
      return reply.code(result.status).send(result.body)
    }
  )
}
export default statisticsRoutes

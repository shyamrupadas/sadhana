import type { FastifyPluginAsync } from 'fastify'
import type { ApiSchemas } from '@sadhana/api-contract'
import { AppError, BadRequestError } from '../../utils/errors'
import { authenticate } from '../../middleware/auth'

const habitsRoutes: FastifyPluginAsync = async (fastify) => {
  const handlers = fastify.apiHandlers
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send(error.toJSON())
    if (error instanceof Error && 'validation' in error)
      return reply.code(400).send(new BadRequestError(error.message).toJSON())
    fastify.log.error(error)
    return reply.code(500).send({ message: 'Internal Server Error', code: 'INTERNAL_ERROR' })
  })
  const label = { type: 'string', minLength: 1, maxLength: 255 }
  const params = { type: 'object', required: ['key'], properties: { key: { type: 'string' } } }
  fastify.get('/', { onRequest: [authenticate] }, async (request, reply) => {
    const result = await handlers.getHabits({ user: request.user! })
    return reply.code(result.status).send(result.body)
  })
  fastify.post<{ Body: ApiSchemas['HabitCreateInput'] }>('/', {
    onRequest: [authenticate],
    schema: { body: { type: 'object', required: ['label', 'creationDate'], properties: {
      label, creationDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    } } },
  }, async (request, reply) => {
    const result = await handlers.createHabit({ user: request.user!, body: request.body })
    return reply.code(result.status).send(result.body)
  })
  fastify.patch<{ Params: { key: string }; Body: ApiSchemas['HabitInput'] }>('/:key', {
    onRequest: [authenticate], schema: { params, body: { type: 'object', required: ['label'], properties: { label } } },
  }, async (request, reply) => {
    const result = await handlers.updateHabit({ user: request.user!, key: request.params.key, body: request.body })
    return reply.code(result.status).send(result.body)
  })
  for (const [path, handler] of [['archive', handlers.archiveHabit], ['restore', handlers.restoreHabit]] as const) {
    fastify.post<{ Params: { key: string } }>(`/:key/${path}`, { onRequest: [authenticate], schema: { params } }, async (request, reply) => {
      const result = await handler({ user: request.user!, key: request.params.key })
      return reply.code(result.status).send(result.body)
    })
  }
  fastify.get<{ Params: { key: string } }>('/:key/deletion-summary', { onRequest: [authenticate], schema: { params } }, async (request, reply) => {
    const result = await handlers.getHabitDeletionSummary({ user: request.user!, key: request.params.key })
    return reply.code(result.status).send(result.body)
  })
  fastify.delete<{ Params: { key: string } }>('/:key', { onRequest: [authenticate], schema: { params } }, async (request, reply) => {
    const result = await handlers.deleteHabit({ user: request.user!, key: request.params.key })
    return reply.code(result.status).send()
  })
}
export default habitsRoutes

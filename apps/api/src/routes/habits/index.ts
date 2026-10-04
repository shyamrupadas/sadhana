import { FastifyPluginAsync } from 'fastify'
import type { ApiHandlers } from '@sadhana/api-contract'
import { HabitsService } from '../../services/habits.service'
import type { ApiSchemas } from '@sadhana/api-contract'
import { AppError } from '../../utils/errors'
import { authenticate } from '../../middleware/auth'

const habitsRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  const habitsService = new HabitsService(fastify)
  const handlers: Pick<ApiHandlers, 'getHabits' | 'createHabit' | 'updateHabit' | 'deleteHabit'> = {
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
  }

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
    Reply: ApiSchemas['HabitDefinition'][] | ApiSchemas['ApiError']
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
                key: { type: 'string' },
                label: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
              },
              required: ['key', 'label', 'createdAt'],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await handlers.getHabits({ user: request.user! })
      return reply.code(result.status).send(result.body)
    }
  )

  fastify.post<{
    Body: ApiSchemas['HabitInput']
    Reply: ApiSchemas['HabitDefinition'] | ApiSchemas['ApiError']
  }>(
    '/',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['label'],
          properties: {
            label: { type: 'string' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              label: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
            required: ['key', 'label', 'createdAt'],
          },
        },
      },
    },
    async (request, reply) => {
      const result = await handlers.createHabit({ user: request.user!, body: request.body })
      return reply.code(result.status).send(result.body)
    }
  )

  fastify.patch<{
    Params: { key: string }
    Body: ApiSchemas['HabitInput']
    Reply: ApiSchemas['HabitDefinition'] | ApiSchemas['ApiError']
  }>(
    '/:key',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          properties: {
            key: { type: 'string' },
          },
          required: ['key'],
        },
        body: {
          type: 'object',
          required: ['label'],
          properties: {
            label: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              label: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
            required: ['key', 'label', 'createdAt'],
          },
        },
      },
    },
    async (request, reply) => {
      const result = await handlers.updateHabit({ user: request.user!, key: request.params.key, body: request.body })
      return reply.code(result.status).send(result.body)
    }
  )

  fastify.delete<{
    Params: { key: string }
  }>(
    '/:key',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          properties: {
            key: { type: 'string' },
          },
          required: ['key'],
        },
        response: {
          204: {},
        },
      },
    },
    async (request, reply) => {
      const result = await handlers.deleteHabit({ user: request.user!, key: request.params.key })
      return reply.code(result.status).send()
    }
  )
}

export default habitsRoutes

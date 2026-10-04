import { FastifyPluginAsync } from 'fastify'
import type { ApiHandlers } from '@sadhana/api-contract'
import { HabitsService } from '../../services/habits.service'
import { ApiShemas } from '../../schema'
import { AppError } from '../../utils/errors'
import { authenticate } from '../../middleware/auth'

const habitsRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  const habitsService = new HabitsService(fastify)
  const handlers: Pick<ApiHandlers, 'getHabits'> = {
    async getHabits({ user }) {
      return { status: 200, body: await habitsService.getAllHabits(user.id) }
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
    Reply: ApiShemas['HabitDefinition'][] | ApiShemas['Error']
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
    Body: ApiShemas['CreateHabitRequest']
    Reply: ApiShemas['HabitDefinition']
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
      const habit = await habitsService.createHabit(request.user!.id, request.body.label)
      return reply.code(201).send(habit)
    }
  )

  fastify.patch<{
    Params: { key: string }
    Body: ApiShemas['UpdateHabitRequest']
    Reply: ApiShemas['HabitDefinition']
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
      const habit = await habitsService.updateHabit(
        request.user!.id,
        request.params.key,
        request.body.label
      )
      return reply.send(habit)
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
      await habitsService.deleteHabit(request.user!.id, request.params.key)
      return reply.code(204).send()
    }
  )
}

export default habitsRoutes

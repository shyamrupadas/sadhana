import { FastifyPluginAsync } from 'fastify'
import type { ApiSchemas } from '@sadhana/api-contract'
import { AppError } from '../../utils/errors'

const isHttpsRequest = (request: { headers: Record<string, unknown> }) =>
  String(request.headers['x-forwarded-proto'] ?? '') === 'https'

const authRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  const handlers = fastify.apiHandlers

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

  fastify.post<{
    Body: ApiSchemas['RegisterRequest']
    Reply: ApiSchemas['AuthResponse'] | ApiSchemas['ApiError']
  }>(
    '/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await handlers.register({ body: request.body, isHttps: isHttpsRequest(request) })
      if ('headers' in result) reply.header('Set-Cookie', result.headers['Set-Cookie'])
      return reply.code(result.status).send(result.body)
    }
  )

  fastify.post<{
    Body: ApiSchemas['LoginRequest']
    Reply: ApiSchemas['AuthResponse'] | ApiSchemas['ApiError']
  }>(
    '/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await handlers.login({ body: request.body, isHttps: isHttpsRequest(request) })
      if ('headers' in result) reply.header('Set-Cookie', result.headers['Set-Cookie'])
      return reply.code(result.status).send(result.body)
    }
  )

  fastify.post<{
    Reply: ApiSchemas['AuthResponse'] | ApiSchemas['ApiError']
  }>(
    '/refresh',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await handlers.refresh({ refreshToken: request.cookies.refreshToken, isHttps: isHttpsRequest(request) })
      if ('headers' in result) reply.header('Set-Cookie', result.headers['Set-Cookie'])
      return reply.code(result.status).send(result.body)
    }
  )
}

export default authRoutes

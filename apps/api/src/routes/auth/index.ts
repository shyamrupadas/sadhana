import { FastifyPluginAsync } from 'fastify'
import type { ApiHandlers } from '@sadhana/api-contract'
import { AuthService } from '../../services/auth.service'
import { ApiShemas } from '../../schema'
import { AppError } from '../../utils/errors'

const isHttpsRequest = (request: { headers: Record<string, unknown> }) =>
  String(request.headers['x-forwarded-proto'] ?? '') === 'https'

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

const authRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  const authService = new AuthService(fastify)
  const handlers: Pick<ApiHandlers, 'register' | 'login' | 'refresh'> = {
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

  fastify.post<{
    Body: ApiShemas['RegisterRequest']
    Reply: ApiShemas['AuthResponse'] | ApiShemas['Error']
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
    Body: ApiShemas['LoginRequest']
    Reply: ApiShemas['AuthResponse'] | ApiShemas['Error']
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
    Reply: ApiShemas['AuthResponse'] | ApiShemas['Error']
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

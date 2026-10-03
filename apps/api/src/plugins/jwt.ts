import { FastifyPluginAsync } from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'
import { JwtRefreshPayload } from '../types/fastify'

const jwtPlugin: FastifyPluginAsync = async (fastify) => {
  const jwtSecret = fastify.config?.JWT_SECRET || process.env.JWT_SECRET
  const jwtRefreshSecret =
    fastify.config?.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET
  const jwtExpiresIn =
    fastify.config?.JWT_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '15m'
  const jwtRefreshExpiresIn =
    fastify.config?.JWT_REFRESH_EXPIRES_IN || process.env.JWT_REFRESH_EXPIRES_IN || '7d'

  if (!jwtSecret || !jwtRefreshSecret) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be set')
  }

  await fastify.register(fastifyJwt, {
    secret: jwtSecret,
    sign: {
      expiresIn: jwtExpiresIn,
    },
  })

  fastify.decorate('refreshSign', async (payload: JwtRefreshPayload) => {
    type RefreshSignFn = (
      payload: JwtRefreshPayload,
      options: { expiresIn: string; key: string }
    ) => string

    const signFn = fastify.jwt.sign as unknown as RefreshSignFn
    return signFn(payload, {
      expiresIn: jwtRefreshExpiresIn,
      key: jwtRefreshSecret,
    })
  })

  fastify.decorate('refreshVerify', async (token: string) => {
    type RefreshVerifyFn = (token: string, options: { key: string }) => JwtRefreshPayload

    const verifyFn = fastify.jwt.verify as unknown as RefreshVerifyFn
    return verifyFn(token, { key: jwtRefreshSecret })
  })

  fastify.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify()
    } catch {
      reply.code(401).send({
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
      })
    }
  })
}

export default fastifyPlugin(jwtPlugin)

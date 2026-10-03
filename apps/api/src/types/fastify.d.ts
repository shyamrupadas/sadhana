import 'fastify'
import { PostgresDb } from '@fastify/postgres'
import '@fastify/jwt'
import '@fastify/cookie'

export interface JwtAccessPayload {
  userId: string
  email: string
  type: 'access'
}

export interface JwtRefreshPayload {
  userId: string
  type: 'refresh'
}

declare module 'fastify' {
  interface FastifyInstance {
    pg: PostgresDb
    config: {
      DATABASE_URL: string
      NODE_ENV: string
      JWT_SECRET: string
      JWT_REFRESH_SECRET: string
      JWT_EXPIRES_IN: string
      JWT_REFRESH_EXPIRES_IN: string
      CORS_ORIGIN: string
    }
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    refreshSign: (payload: JwtRefreshPayload) => Promise<string>
    refreshVerify: (token: string) => Promise<JwtRefreshPayload>
  }

  interface FastifyRequest {
    user?: {
      id: string
      email: string
    }
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtAccessPayload | JwtRefreshPayload
    user: {
      id: string
      email: string
    }
  }
}

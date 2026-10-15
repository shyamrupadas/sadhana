import 'fastify'
import type { Configuration } from '../config/environment'
import { PostgresDb } from '@fastify/postgres'
import '@fastify/jwt'
import '@fastify/cookie'
import type { ApiHandlers } from '@sadhana/api-contract'

export interface JwtAccessPayload {
  userId: string
  email: string
  type: 'access'
}

export interface JwtRefreshPayload {
  userId: string
  type: 'refresh'
  jti: string
}

declare module 'fastify' {
  interface FastifyInstance {
    apiHandlers: ApiHandlers
    pg: PostgresDb
    config: Configuration
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

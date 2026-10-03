import { FastifyRequest } from 'fastify'
import { UnauthorizedError } from '../utils/errors'
import { JwtAccessPayload } from '../types/fastify'

export async function authenticate(request: FastifyRequest) {
  try {
    const decoded = await request.jwtVerify<JwtAccessPayload>()

    if (decoded.type !== 'access') {
      throw new UnauthorizedError('Invalid token type')
    }

    const user: { id: string; email: string } = {
      id: decoded.userId,
      email: decoded.email,
    }
    request.user = user
  } catch {
    throw new UnauthorizedError('Invalid or expired token')
  }
}

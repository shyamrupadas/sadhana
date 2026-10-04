import { FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import { randomUUID } from 'node:crypto'
import { ApiShemas } from '../schema'
import { UnauthorizedError, BadRequestError } from '../utils/errors'

const SALT_ROUNDS = 10

export class AuthService {
  constructor(private fastify: FastifyInstance) {}

  async register(email: string, password: string): Promise<ApiShemas['AuthResponse']> {
    const client = await this.fastify.pg.connect()

    try {
      const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [
        email,
      ])

      if (existingUser.rows.length > 0) {
        throw new BadRequestError('User with this email already exists')
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

      const result = await client.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email, passwordHash]
      )

      const user = result.rows[0]
      const accessToken = await this.generateAccessToken(user.id, user.email)

      return {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
        },
      }
    } finally {
      client.release()
    }
  }

  async login(email: string, password: string): Promise<ApiShemas['AuthResponse']> {
    const client = await this.fastify.pg.connect()

    try {
      const result = await client.query(
        'SELECT id, email, password_hash FROM users WHERE email = $1',
        [email]
      )

      if (result.rows.length === 0) {
        throw new UnauthorizedError('Invalid email or password')
      }

      const user = result.rows[0]
      const isPasswordValid = await bcrypt.compare(password, user.password_hash)

      if (!isPasswordValid) {
        throw new UnauthorizedError('Invalid email or password')
      }

      const accessToken = await this.generateAccessToken(user.id, user.email)

      return {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
        },
      }
    } finally {
      client.release()
    }
  }

  async getUserById(id: string): Promise<ApiShemas['User'] | null> {
    const client = await this.fastify.pg.connect()

    try {
      const result = await client.query('SELECT id, email FROM users WHERE id = $1', [id])

      if (result.rows.length === 0) {
        return null
      }

      return result.rows[0]
    } finally {
      client.release()
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<ApiShemas['AuthResponse']> {
    try {
      const payload = await this.fastify.refreshVerify(refreshToken)
      if (payload.type !== 'refresh') {
        throw new UnauthorizedError('Invalid token type')
      }
      const user = await this.getUserById(payload.userId)

      if (!user) {
        throw new UnauthorizedError('User not found')
      }

      const accessToken = await this.generateAccessToken(user.id, user.email)

      return {
        accessToken,
        user,
      }
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token')
    }
  }

  async generateRefreshTokenForUser(userId: string): Promise<string> {
    return this.generateRefreshToken(userId)
  }

  private async generateAccessToken(userId: string, email: string): Promise<string> {
    return this.fastify.jwt.sign({
      userId,
      email,
      type: 'access',
    })
  }

  private async generateRefreshToken(userId: string): Promise<string> {
    return this.fastify.refreshSign({
      userId,
      type: 'refresh',
      jti: randomUUID(),
    })
  }
}

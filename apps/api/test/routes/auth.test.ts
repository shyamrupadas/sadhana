import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { FastifyInstance } from 'fastify'
import cookiePlugin from '../../src/plugins/cookie'
import jwtPlugin from '../../src/plugins/jwt'
import authRoutes from '../../src/routes/auth'
import { createApiHandlers } from '../../src/api-handlers'

test('auth HTTP endpoints issue and rotate HttpOnly refresh cookies without exposing refresh tokens in JSON', async (t) => {
  const app = Fastify()
  t.after(() => app.close())
  const users = new Map<string, { id: string; email: string; password_hash: string }>()
  app.decorate('config', {
    JWT_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    JWT_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
  } as FastifyInstance['config'])
  app.decorate('pg', {
    connect: async () => ({
      query: async (sql: string, params: string[]) => {
        if (sql.startsWith('INSERT INTO users')) {
          const user = { id: String(users.size + 1), email: params[0], password_hash: params[1] }
          users.set(user.email, user)
          return { rows: [user] }
        }
        if (sql.includes('WHERE email')) {
          const user = users.get(params[0])
          return { rows: user ? [user] : [] }
        }
        const user = [...users.values()].find(({ id }) => id === params[0])
        return { rows: user ? [user] : [] }
      },
      release: () => undefined,
    }),
  } as unknown as FastifyInstance['pg'])
  await app.register(cookiePlugin)
  await app.register(jwtPlugin)
  app.decorate('apiHandlers', createApiHandlers(app))
  await app.register(authRoutes, { prefix: '/auth' })
  await app.ready()

  const register = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'alice@example.test', password: 'secret1' } })
  assert.equal(register.statusCode, 201)
  assert.deepEqual(Object.keys(register.json()).sort(), ['accessToken', 'user'])
  assert.equal(register.json().user.email, 'alice@example.test')
  const initialCookie = register.headers['set-cookie'] as string
  assert.match(initialCookie, /^refreshToken=/)
  assert.match(initialCookie, /HttpOnly/)
  assert.match(initialCookie, /SameSite=Lax/)
  assert.doesNotMatch(initialCookie, /Secure/)

  const invalidBody = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'invalid', password: 'short' } })
  assert.equal(invalidBody.statusCode, 500)
  assert.equal(invalidBody.json().code, 'INTERNAL_ERROR')
  assert.equal(invalidBody.headers['set-cookie'], undefined)

  const duplicate = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'alice@example.test', password: 'secret1' } })
  assert.equal(duplicate.statusCode, 400)
  assert.equal(duplicate.json().code, 'BAD_REQUEST')

  const badLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'alice@example.test', password: 'wrong' } })
  assert.equal(badLogin.statusCode, 401)
  assert.equal(badLogin.json().code, 'UNAUTHORIZED')

  const login = await app.inject({ method: 'POST', url: '/auth/login', headers: { 'x-forwarded-proto': 'https' }, payload: { email: 'alice@example.test', password: 'secret1' } })
  assert.equal(login.statusCode, 200)
  assert.deepEqual(Object.keys(login.json()).sort(), ['accessToken', 'user'])
  const loginCookie = login.headers['set-cookie'] as string
  assert.match(loginCookie, /HttpOnly/)
  assert.match(loginCookie, /SameSite=None/)
  assert.match(loginCookie, /Secure/)
  assert.notEqual(loginCookie.split(';')[0], initialCookie.split(';')[0])

  const noCookie = await app.inject({ method: 'POST', url: '/auth/refresh' })
  assert.equal(noCookie.statusCode, 401)
  assert.equal(noCookie.json().code, 'UNAUTHORIZED')

  const refresh = await app.inject({ method: 'POST', url: '/auth/refresh', headers: { cookie: loginCookie.split(';')[0], 'x-forwarded-proto': 'https' } })
  assert.equal(refresh.statusCode, 200)
  assert.deepEqual(Object.keys(refresh.json()).sort(), ['accessToken', 'user'])
  assert.notEqual((refresh.headers['set-cookie'] as string).split(';')[0], loginCookie.split(';')[0])
  assert.match(refresh.headers['set-cookie'] as string, /SameSite=None/)

  const expired = app.jwt.sign({ userId: '1', type: 'refresh', jti: 'expired-token' }, { key: 'refresh-secret', expiresIn: -1 })
  const expiredResponse = await app.inject({ method: 'POST', url: '/auth/refresh', headers: { cookie: `refreshToken=${expired}` } })
  assert.equal(expiredResponse.statusCode, 401)
  assert.equal(expiredResponse.json().code, 'UNAUTHORIZED')

  const wrongType = app.jwt.sign({ userId: '1', email: 'alice@example.test', type: 'access' }, { key: 'refresh-secret' })
  const wrongTypeResponse = await app.inject({ method: 'POST', url: '/auth/refresh', headers: { cookie: `refreshToken=${wrongType}` } })
  assert.equal(wrongTypeResponse.statusCode, 401)

})

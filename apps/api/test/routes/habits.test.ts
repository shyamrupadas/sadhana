import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { FastifyInstance } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import habitsRoutes from '../../src/routes/habits'

test('GET /habits returns only the authenticated user\'s habits and rejects missing bearer', async (t) => {
  const app = Fastify()
  t.after(() => app.close())
  const rows = [
    { userId: 'alice', key: 'read', label: 'Чтение', created_at: new Date('2026-10-03T09:00:00.000Z') },
    { userId: 'bob', key: 'walk', label: 'Прогулка', created_at: new Date('2026-10-04T09:00:00.000Z') },
  ]
  app.decorate('pg', {
    connect: async () => ({
      query: async (_sql: string, params: string[]) => ({ rows: rows.filter((row) => row.userId === params[0]) }),
      release: () => undefined,
    }),
  } as unknown as FastifyInstance['pg'])
  await app.register(fastifyJwt, { secret: 'test-secret' })
  await app.register(habitsRoutes, { prefix: '/habits' })
  await app.ready()

  const unauthorized = await app.inject({ method: 'GET', url: '/habits' })
  assert.equal(unauthorized.statusCode, 401)
  assert.equal(unauthorized.json().code, 'UNAUTHORIZED')

  for (const [userId, expectedKey] of [['alice', 'read'], ['bob', 'walk']]) {
    const token = app.jwt.sign({ userId, email: `${userId}@example.test`, type: 'access' })
    const response = await app.inject({ method: 'GET', url: '/habits', headers: { authorization: `Bearer ${token}` } })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), [{ key: expectedKey, label: userId === 'alice' ? 'Чтение' : 'Прогулка', createdAt: userId === 'alice' ? '2026-10-03T09:00:00.000Z' : '2026-10-04T09:00:00.000Z' }])
  }
})

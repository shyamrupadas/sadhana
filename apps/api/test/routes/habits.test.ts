import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { FastifyInstance } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import habitsRoutes from '../../src/routes/habits'
import { createApiHandlers } from '../../src/api-handlers'

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
  app.decorate('apiHandlers', createApiHandlers(app))
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

test('habit mutations preserve status, ownership, duplicate-key and error behavior', async (t) => {
  const app = Fastify()
  t.after(() => app.close())
  const createdAt = new Date('2026-10-04T09:00:00.000Z')
  const rows: Array<{ userId: string; key: string; label: string; created_at: Date }> = []
  app.decorate('pg', {
    connect: async () => ({
      query: async (sql: string, params: string[]) => {
        if (sql.startsWith('SELECT')) {
          return { rows: rows.filter((row) => row.userId === params[0] && (!params[1] || row.key === params[1])) }
        }
        if (sql.startsWith('INSERT')) {
          const row = { userId: params[0], key: params[1], label: params[2], created_at: createdAt }
          rows.push(row)
          return { rows: [row] }
        }
        if (sql.startsWith('UPDATE')) {
          const row = rows.find((item) => item.userId === params[1] && item.key === params[2])
          if (row) row.label = params[0]
          return { rows: row ? [row] : [] }
        }
        const index = rows.findIndex((row) => row.userId === params[0] && row.key === params[1])
        if (index >= 0) rows.splice(index, 1)
        return { rowCount: index >= 0 ? 1 : 0 }
      },
      release: () => undefined,
    }),
  } as unknown as FastifyInstance['pg'])
  await app.register(fastifyJwt, { secret: 'test-secret' })
  app.decorate('apiHandlers', createApiHandlers(app))
  await app.register(habitsRoutes, { prefix: '/habits' })
  await app.ready()

  const auth = (userId: string) => ({ authorization: `Bearer ${app.jwt.sign({ userId, email: `${userId}@example.test`, type: 'access' })}` })
  const alice = auth('alice')
  const bob = auth('bob')
  const create = await app.inject({ method: 'POST', url: '/habits', headers: alice, payload: { label: 'Read' } })
  assert.equal(create.statusCode, 201)
  assert.deepEqual(create.json(), { key: 'read', label: 'Read', createdAt: createdAt.toISOString() })

  const duplicate = await app.inject({ method: 'POST', url: '/habits', headers: alice, payload: { label: 'read' } })
  assert.equal(duplicate.statusCode, 201)
  assert.deepEqual(duplicate.json(), create.json())
  assert.equal(rows.length, 1)

  const forbiddenRename = await app.inject({ method: 'PATCH', url: '/habits/read', headers: bob, payload: { label: 'Changed' } })
  assert.equal(forbiddenRename.statusCode, 404)
  assert.deepEqual(forbiddenRename.json(), { message: 'Habit not found', code: 'NOT_FOUND' })

  const rename = await app.inject({ method: 'PATCH', url: '/habits/read', headers: alice, payload: { label: 'Books' } })
  assert.equal(rename.statusCode, 200)
  assert.deepEqual(rename.json(), { key: 'read', label: 'Books', createdAt: createdAt.toISOString() })
  assert.deepEqual((await app.inject({ method: 'GET', url: '/habits', headers: bob })).json(), [])

  const forbiddenDelete = await app.inject({ method: 'DELETE', url: '/habits/read', headers: bob })
  assert.equal(forbiddenDelete.statusCode, 404)
  const deleted = await app.inject({ method: 'DELETE', url: '/habits/read', headers: alice })
  assert.equal(deleted.statusCode, 204)
  assert.equal(deleted.body, '')
  assert.equal(deleted.headers['content-type'], undefined)
  assert.deepEqual((await app.inject({ method: 'GET', url: '/habits', headers: alice })).json(), [])

  const missing = await app.inject({ method: 'PATCH', url: '/habits/missing', headers: alice, payload: { label: 'Missing' } })
  assert.equal(missing.statusCode, 404)
  assert.equal(missing.json().code, 'NOT_FOUND')
  assert.equal((await app.inject({ method: 'DELETE', url: '/habits/missing', headers: alice })).statusCode, 404)
  assert.equal((await app.inject({ method: 'POST', url: '/habits', payload: { label: 'Read' } })).statusCode, 401)
  const invalid = await app.inject({ method: 'POST', url: '/habits', headers: alice, payload: {} })
  assert.equal(invalid.statusCode, 500)
  assert.equal(invalid.json().code, 'INTERNAL_ERROR')
})

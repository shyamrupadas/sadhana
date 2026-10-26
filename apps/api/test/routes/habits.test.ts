import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import habitsRoutes from '../../src/routes/habits'
import { createApiHandlers } from '../../src/api-handlers'
import { ApiClient, ApiClientError, type ApiSchemas } from '@sadhana/api-contract'

test('habit lifecycle keeps UUID identity, ownership and explicit deletion metadata through HTTP', async (t) => {
  const app = Fastify()
  t.after(() => app.close())
  const rows: (ApiSchemas['HabitDefinition'] & { userId: string })[] = []
  app.decorate('pg', {
    query: async (sql: string, params: (string | boolean)[]) => {
      if (sql.startsWith('INSERT')) {
        const row = { key: String(params[0]), userId: String(params[1]), label: String(params[2]), startDate: String(params[3]), createdAt: '2026-10-04T09:00:00.000000', archived: false }
        rows.push(row)
        return { rows: [row] }
      }
      if (sql.startsWith('UPDATE')) {
        const row = rows.find((item) => item.userId === params[1] && item.key === params[2])
        if (row) {
          if (sql.includes('SET label')) row.label = String(params[0])
          else row.archived = Boolean(params[0])
        }
        return { rows: row ? [row] : [] }
      }
      const own = rows.filter((row) => row.userId === params[0] && (!params[1] || row.key === params[1]))
      if (sql.startsWith('DELETE')) {
        for (const row of own) rows.splice(rows.indexOf(row), 1)
        return { rowCount: own.length }
      }
      if (sql.includes('count(m.habit_id)')) return { rows: own.map((row) => ({ key: row.key, label: row.label, markCount: 243 })) }
      if (sql.startsWith('SELECT')) return { rows: own }
      throw new Error(`Unexpected SQL ${sql}`)
    },
  } as unknown as FastifyInstance['pg'])
  await app.register(fastifyJwt, { secret: 'test-secret' })
  app.decorate('apiHandlers', createApiHandlers(app))
  await app.register(habitsRoutes, { prefix: '/habits' })
  await app.ready()
  const clientFor = (userId: string) => new ApiClient({ fetch: async (input, init) => {
    const response = await app.inject({ method: init?.method as 'POST', url: String(input), payload: init?.body as string, headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${app.jwt.sign({ userId, email: `${userId}@example.test`, type: 'access' })}`,
    } })
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode })
  } })
  const alice = clientFor('alice'), bob = clientFor('bob')
  assert.equal((await app.inject('/habits')).statusCode, 401)
  const input = { label: 'Чтение', creationDate: '2026-10-04' }
  const first = await alice.createHabit(input)
  assert.match(first.key, /^[0-9a-f-]{36}$/)
  assert.equal(first.startDate, input.creationDate)
  const second = await alice.createHabit(input)
  assert.notEqual(second.key, first.key)
  assert.deepEqual(await bob.getHabits(), [])
  await assert.rejects(bob.updateHabit(first.key, { label: 'Чужая' }), (error: ApiClientError) => error.status === 404)
  await assert.rejects(bob.getHabitDeletionSummary(first.key), (error: ApiClientError) => error.status === 404)
  const renamed = await alice.updateHabit(first.key, { label: 'Книги' })
  assert.equal(renamed.key, first.key)
  assert.equal(renamed.label, 'Книги')
  assert.equal((await alice.archiveHabit(first.key)).archived, true)
  const restored = await alice.restoreHabit(first.key)
  assert.equal(restored.archived, false)
  assert.equal(restored.key, first.key)
  assert.deepEqual(await alice.getHabitDeletionSummary(first.key), { key: first.key, label: 'Книги', markCount: 243 })
  await assert.rejects(bob.deleteHabit(first.key), (error: ApiClientError) => error.status === 404)
  await alice.deleteHabit(first.key)
  assert.deepEqual((await alice.getHabits()).map((row) => row.key), [second.key])
  await assert.rejects(alice.restoreHabit(first.key), (error: ApiClientError) => error.status === 404)
  await assert.rejects(alice.createHabit({ ...input, creationDate: '2026-02-30' }), (error: ApiClientError) => error.status === 400)
  await assert.rejects(alice.createHabit({ ...input, label: ' ' }), (error: ApiClientError) => error.status === 400)
})

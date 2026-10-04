import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ApiClient, ApiClientError } from '../dist/src/index.js'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))

test('client returns typed JSON and retains HTTP status on malformed error body', async () => {
  const calls = []
  const client = new ApiClient({
    baseUrl: 'https://example.test',
    fetch: async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify([{ key: 'read', label: 'Чтение', createdAt: '2026-10-04T00:00:00.000Z' }]), { status: 200 })
    },
  })
  const controller = new AbortController()
  assert.equal((await client.getHabits({ signal: controller.signal }))[0].key, 'read')
  assert.equal(calls[0].input, 'https://example.test/habits')
  assert.equal(calls[0].init.signal, controller.signal)

  const errorClient = new ApiClient({ fetch: async () => new Response('unavailable', { status: 503 }) })
  await assert.rejects(errorClient.getHabits(), (error) => {
    assert.ok(error instanceof ApiClientError)
    assert.equal(error.status, 503)
    assert.equal(error.body, 'unavailable')
    return true
  })

  const emptyClient = new ApiClient({ fetch: async () => new Response(null, { status: 204 }) })
  assert.equal(await emptyClient.getHabits(), undefined)
})

test('auth client sends JSON credentials and leaves refresh cookies to the supplied transport', async () => {
  const calls = []
  const client = new ApiClient({
    fetch: async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ accessToken: 'access', user: { id: '1', email: 'alice@example.test' } }), { status: input === '/auth/register' ? 201 : 200 })
    },
  })

  assert.equal((await client.register({ email: 'alice@example.test', password: 'secret1' })).accessToken, 'access')
  assert.equal((await client.login({ email: 'alice@example.test', password: 'secret1' })).accessToken, 'access')
  assert.equal((await client.refresh()).accessToken, 'access')
  assert.deepEqual(calls.map(({ input }) => input), ['/auth/register', '/auth/login', '/auth/refresh'])
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'alice@example.test', password: 'secret1' })
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
  assert.equal(calls[2].init.body, undefined)
  assert.equal(calls.every(({ init }) => !init.headers?.Authorization), true)
})

test('habit mutation client sends encoded keys, JSON bodies and accepts empty 204', async () => {
  const calls = []
  const client = new ApiClient({
    fetch: async (input, init) => {
      calls.push({ input, init })
      if (init.method === 'DELETE') return new Response(null, { status: 204 })
      return new Response(JSON.stringify({ key: 'read', label: 'Read', createdAt: '2026-10-04T09:00:00.000Z' }), { status: init.method === 'POST' ? 201 : 200 })
    },
  })
  assert.equal((await client.createHabit({ label: 'Read' })).key, 'read')
  assert.equal((await client.updateHabit('read/one', { label: 'Books' })).label, 'Read')
  assert.equal(await client.deleteHabit('read/one'), undefined)
  assert.deepEqual(calls.map(({ input, init }) => [input, init.method]), [
    ['/habits', 'POST'],
    ['/habits/read%2Fone', 'PATCH'],
    ['/habits/read%2Fone', 'DELETE'],
  ])
  assert.deepEqual(JSON.parse(calls[0].init.body), { label: 'Read' })
  assert.deepEqual(JSON.parse(calls[1].init.body), { label: 'Books' })
  assert.equal(calls[2].init.body, undefined)
})

test('sleep records client sends list, date and optional sleep fields through the supplied transport', async () => {
  const calls = []
  const entry = { id: '2026-10-02', date: '2026-10-02', sleep: { bedtime: null, wakeTime: null, napDuration: null, duration: null }, habits: [] }
  const client = new ApiClient({
    fetch: async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify(input === '/sleep-records' ? [entry] : entry), { status: 200 })
    },
  })
  const controller = new AbortController()
  assert.equal((await client.getSleepRecords({ signal: controller.signal }))[0].date, entry.date)
  assert.equal((await client.getSleepRecord(entry.date)).id, entry.id)
  assert.equal((await client.putSleepRecord(entry.date, { napDuration: 0 })).id, entry.id)
  assert.deepEqual(calls.map(({ input, init }) => [input, init.method]), [
    ['/sleep-records', 'GET'],
    ['/sleep-records/2026-10-02', 'GET'],
    ['/sleep-records/2026-10-02', 'PUT'],
  ])
  assert.equal(calls[0].init.signal, controller.signal)
  assert.deepEqual(JSON.parse(calls[2].init.body), { napDuration: 0 })
})

test('daily habit mark client encodes both path values and sends the selected value', async () => {
  const calls = []
  const entry = { id: '2026-10-02', date: '2026-10-02', sleep: { bedtime: null, wakeTime: null, napDuration: null, duration: null }, habits: [{ key: 'read/one', value: false }] }
  const client = new ApiClient({ fetch: async (input, init) => {
    calls.push({ input, init })
    return new Response(JSON.stringify(entry), { status: 200 })
  } })

  assert.deepEqual(await client.setDailyHabitMark('2026-10-02', 'read/one', { value: false }), entry)
  assert.deepEqual(await client.removeDailyHabitMark('2026-10-02', 'read/one'), entry)
  assert.deepEqual(calls.map(({ input, init }) => [input, init.method]), [
    ['/sleep-records/2026-10-02/habits/read%2Fone', 'PATCH'],
    ['/sleep-records/2026-10-02/habits/read%2Fone', 'DELETE'],
  ])
  assert.deepEqual(JSON.parse(calls[0].init.body), { value: false })
  assert.equal(calls[1].init.body, undefined)
})

test('yesterday check and sleep stats keep their nullable HTTP response shapes', async () => {
  const calls = []
  const stats = {
    week: { bedtime: '23:00', wakeTime: '07:00', duration: '8:00' },
    month: { bedtime: null, wakeTime: null, duration: null },
    year: { bedtime: null, wakeTime: null, duration: null },
  }
  const client = new ApiClient({ fetch: async (input, init) => {
    calls.push([input, init.method])
    return new Response(JSON.stringify(input === '/sleep-stats' ? stats : { hasData: true }), { status: 200 })
  } })
  assert.deepEqual(await client.checkYesterday(), { hasData: true })
  assert.deepEqual(await client.getSleepStats(), stats)
  assert.deepEqual(calls, [
    ['/sleep-records/yesterday/check', 'GET'],
    ['/sleep-stats', 'GET'],
  ])
})

test('sleep time fields keep nullable values and date-time patterns in the same OpenAPI schema', async () => {
  const document = JSON.parse(await readFile(join(packageRoot, 'generated/openapi/openapi.json'), 'utf8'))
  for (const name of ['SleepData', 'SleepDataInput']) {
    const schema = document.components.schemas[name]
    for (const field of ['bedtime', 'wakeTime']) {
      assert.deepEqual(schema.properties[field], {
        type: 'string', nullable: true, pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$',
      })
    }
  }
  assert.deepEqual(document.components.schemas.SleepDataInput.required, ['napDuration'])
})

test('generated HTTP contract covers the inventoried operations and response statuses', async () => {
  const document = JSON.parse(await readFile(join(packageRoot, 'generated/openapi/openapi.json'), 'utf8'))
  const expected = {
    'POST /auth/register': [201, 400, 500],
    'POST /auth/login': [200, 401, 500],
    'POST /auth/refresh': [200, 401, 500],
    'GET /habits': [200, 401, 500],
    'POST /habits': [201, 401, 500],
    'PATCH /habits/{key}': [200, 401, 404, 500],
    'DELETE /habits/{key}': [204, 401, 404, 500],
    'GET /sleep-records': [200, 401, 500],
    'GET /sleep-records/{date}': [200, 401, 404, 500],
    'PUT /sleep-records/{date}': [200, 401, 500],
    'PATCH /sleep-records/{date}/habits/{habitKey}': [200, 401, 500],
    'DELETE /sleep-records/{date}/habits/{habitKey}': [200, 401, 404, 500],
    'GET /sleep-records/yesterday/check': [200, 401, 500],
    'GET /sleep-stats': [200, 401, 500],
  }
  const actual = Object.fromEntries(Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => [
      `${method.toUpperCase()} ${path}`,
      Object.keys(operation.responses).map(Number).sort((a, b) => a - b),
    ])
  ))
  assert.deepEqual(actual, expected)

  for (const path of ['/auth/register', '/auth/login', '/auth/refresh']) {
    const response = document.paths[path].post.responses[path === '/auth/register' ? 201 : 200]
    const cookieHeader = response.headers['Set-Cookie']
    assert.ok(cookieHeader)
    for (const attribute of ['refreshToken', 'HttpOnly', 'Path=/', 'Max-Age=604800', 'x-forwarded-proto', 'Secure', 'SameSite=None', 'SameSite=Lax']) {
      assert.ok(cookieHeader.description?.includes(attribute), `${path} must document ${attribute}`)
    }
  }
  assert.equal(document.paths['/auth/refresh'].post.parameters[0].in, 'cookie')
  assert.equal(document.paths['/habits/{key}'].delete.responses[204].content, undefined)
  assert.equal(document.components.schemas.SleepDataInput.required.includes('bedtime'), false)
  assert.equal(document.components.schemas.SleepDataInput.required.includes('wakeTime'), false)
})

test('generator rejects unsupported schema constructs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sadhana-contract-'))
  try {
    const schema = JSON.parse(await readFile(join(packageRoot, 'generated/openapi/openapi.json'), 'utf8'))
    schema.components.schemas.HabitDefinition.oneOf = [{ type: 'string' }]
    const path = join(dir, 'unsupported.json')
    await writeFile(path, JSON.stringify(schema))
    assert.throws(() => execFileSync('node', ['scripts/generate.mjs', path], { cwd: packageRoot, stdio: 'pipe' }), /Unsupported contract construct/)

    delete schema.components.schemas.HabitDefinition.oneOf
    schema.paths['/habits'].get.responses[200].headers = { 'x-extra': { schema: { type: 'string' } } }
    await writeFile(path, JSON.stringify(schema))
    assert.throws(() => execFileSync('node', ['scripts/generate.mjs', path], { cwd: packageRoot, stdio: 'pipe' }), /Unsupported contract construct/)

    delete schema.paths['/habits'].get.responses[200].headers
    schema.paths['/habits'].parameters = [{ name: 'unused', in: 'query', schema: { type: 'string' } }]
    await writeFile(path, JSON.stringify(schema))
    assert.throws(() => execFileSync('node', ['scripts/generate.mjs', path], { cwd: packageRoot, stdio: 'pipe' }), /Unsupported contract construct/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('repeated generation leaves committed artifacts unchanged', async () => {
  const paths = ['generated/openapi/openapi.json', 'generated/openapi/types.ts', 'generated/client.ts', 'generated/handlers.ts']
  const before = await Promise.all(paths.map((path) => readFile(join(packageRoot, path), 'utf8')))
  execFileSync('pnpm', ['generate'], { cwd: packageRoot, stdio: 'pipe' })
  const after = await Promise.all(paths.map((path) => readFile(join(packageRoot, path), 'utf8')))
  assert.deepEqual(after, before)
})

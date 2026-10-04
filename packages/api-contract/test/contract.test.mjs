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

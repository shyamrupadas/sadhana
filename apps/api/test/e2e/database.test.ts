import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { E2eAccounts } from './database'

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'sadhana-e2e-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const queries: Array<{ sql: string; values: unknown[] }> = []
  let failDelete = false
  const database = {
    async query(sql: string, values: unknown[]) {
      if (failDelete && sql.startsWith('DELETE')) throw new Error('database unavailable')
      queries.push({ sql, values })
    },
  }
  const accounts = new E2eAccounts(directory, 'dev-target', database)
  return {
    directory,
    accounts,
    database,
    queries,
    failCleanup: () => {
      failDelete = true
    },
  }
}

test('E2E cleanup refuses untracked/manual accounts and targets only an exact owned account', async (t) => {
  const { accounts, queries } = fixture(t)
  const runId = randomUUID()
  await accounts.start(runId, process.pid)
  const account = accounts.reserve(runId)
  await assert.rejects(accounts.remove(runId, 'daily@example.test'), /not tracked/)
  assert.equal(queries.length, 0)

  const seeded = await accounts.seed(runId, account.email, 'test-password')
  await accounts.remove(runId, account.email)
  assert.match(queries[1].sql, /WHERE email = \$1 AND \(\$2::uuid IS NULL OR id = \$2\)/)
  assert.deepEqual(queries[1].values, [account.email, seeded.id])
})

test('recovery cleans a lost registration response by reserved email and preserves active runs', async (t) => {
  const { accounts, queries } = fixture(t)
  const stale = randomUUID()
  await accounts.start(stale, 100)
  const orphan = accounts.reserve(stale)
  const active = randomUUID()
  await accounts.start(active, 200, () => true)
  const activeAccount = accounts.reserve(active)
  await accounts.start(randomUUID(), 300, (pid) => pid === 200)
  assert.deepEqual(
    queries.map(({ values }) => values),
    [[orphan.email, null]]
  )
  await accounts.remove(active, activeAccount.email)
})

test('failed cleanup leaves the account tracked for the next run', async (t) => {
  const { directory, accounts, failCleanup } = fixture(t)
  const runId = randomUUID()
  await accounts.start(runId, process.pid)
  const account = accounts.reserve(runId)
  failCleanup()
  await assert.rejects(accounts.finish(runId), /database unavailable/)
  assert.deepEqual(
    JSON.parse(readFileSync(join(directory, `${runId}.json`), 'utf8')).accounts,
    [account]
  )
})

test('recovery rejects a changed dev target or a corrupted ownership record before DELETE', async (t) => {
  const { directory, accounts, database, queries } = fixture(t)
  const runId = randomUUID()
  await accounts.start(runId, process.pid)
  accounts.reserve(runId)
  const otherTarget = new E2eAccounts(directory, 'other-target', database)
  await assert.rejects(otherTarget.finish(runId), /another dev database/)
  const path = join(directory, `${runId}.json`)
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  manifest.accounts[0].email = 'daily@example.test'
  writeFileSync(path, JSON.stringify(manifest))
  await assert.rejects(accounts.finish(runId), /invalid/)
  assert.equal(queries.length, 0)
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { prepareFixtureSource } from '../../src/db/git-fixture-source'

test('historical fixture source is pinned and runnable without reading secrets or changing worktree/index', async (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'sadhana-source-repo-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.test')
  const files = [
    'src/db/dev-fixtures.ts',
    'src/db/migrate.ts',
    'src/config/environment.ts',
    'package.json',
    ...readdirSync(join(__dirname, '../../src/db/migrations'))
      .filter((file) => file.endsWith('.sql'))
      .map((file) => `src/db/migrations/${file}`),
  ]
  for (const file of files) {
    const destination = join(repo, 'apps/api', file)
    mkdirSync(dirname(destination), { recursive: true })
    let content = readFileSync(join(__dirname, '../../', file), 'utf8')
    if (file === 'src/db/dev-fixtures.ts')
      content = content.replace("generator: '1'", "generator: 'historical-fixture'")
    writeFileSync(destination, content)
  }
  writeFileSync(
    join(repo, 'apps/api/.env.dev.local'),
    'throw new Error("historical secrets must never be read")'
  )
  git('add', '.')
  git('commit', '-qm', 'source')
  const commit = git('rev-parse', 'HEAD').trim()
  writeFileSync(join(repo, 'reviewed.txt'), 'staged\n')
  git('add', 'reviewed.txt')
  writeFileSync(join(repo, 'reviewed.txt'), 'unstaged\n')
  const before = git('status', '--porcelain=v1')
  const index = git('diff', '--cached', '--binary')
  const options = {
    repoRoot: repo,
    sourceRef: 'HEAD',
    to: '006',
    date: '2026-01-02',
    password: 'local-fixture-only',
  }
  const source = await prepareFixtureSource(options)
  assert.equal(source.commit, commit)
  assert.equal(source.generator, 'historical-fixture')
  assert.equal(existsSync(join(source.directory, '.env.dev.local')), false)
  assert.equal(existsSync(join(source.directory, 'apps/api/.env.dev.local')), false)
  const directory = source.directory
  await source.cleanup()
  assert.equal(existsSync(directory), false)
  assert.equal(git('status', '--porcelain=v1'), before)
  assert.equal(git('diff', '--cached', '--binary'), index)
  assert.equal(readFileSync(join(repo, 'reviewed.txt'), 'utf8'), 'unstaged\n')

  for (const change of [
    { sourceRef: 'missing-ref' },
    { to: '005' },
    { date: '2026-02-30' },
    { password: '' },
  ])
    await assert.rejects(prepareFixtureSource({ ...options, ...change }))

  git('rm', 'apps/api/src/db/migrations/002_create_habits_and_daily_entries.sql')
  git('commit', '-qm', 'unsupported SQL prefix')
  await assert.rejects(prepareFixtureSource(options), /source preparation failed/i)
  // Restore the SQL from the known source without changing this test repository's branch.
  const sql = 'apps/api/src/db/migrations/002_create_habits_and_daily_entries.sql'
  writeFileSync(join(repo, sql), git('show', `${commit}:${sql}`))
  git('add', sql)
  git('commit', '-qm', 'restore prefix')

  // Even a valid sequence and compatible generator cannot authorize SQL outside public.
  const changedSql =
    'apps/api/src/db/migrations/006_set_duration_min_null_for_missing_times.sql'
  const originalSql = git('show', `${commit}:${changedSql}`)
  writeFileSync(
    join(repo, changedSql),
    `${originalSql}\nCREATE TABLE outside_reset.unexpected (id int);\n`
  )
  git('add', changedSql)
  git('commit', '-qm', 'unsupported SQL scope')
  await assert.rejects(prepareFixtureSource(options), /source preparation failed/i)
  writeFileSync(join(repo, changedSql), originalSql)
  git('add', changedSql)
  git('commit', '-qm', 'restore supported SQL')

  // A valid schema declaration cannot hide an unavailable historical dependency/check.
  writeFileSync(
    join(repo, 'apps/api/src/db/dev-fixtures.ts'),
    "import './missing-check'; export const devFixtureVersion = { generator: '1', schema: '006' }"
  )
  git('add', 'apps/api/src/db/dev-fixtures.ts')
  git('commit', '-qm', 'unusable historical code')
  await assert.rejects(prepareFixtureSource(options), /source preparation failed/i)
})

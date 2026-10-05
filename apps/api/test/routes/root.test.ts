import { test } from 'node:test'
import * as assert from 'node:assert'
import { build } from '../helper'

test('default root route and shared API handlers are wired', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    url: '/'
  })
  assert.deepStrictEqual(JSON.parse(res.payload), { root: true })

  const refresh = await app.inject({ method: 'POST', url: '/auth/refresh' })
  assert.equal(refresh.statusCode, 401)
  assert.equal(refresh.json().code, 'UNAUTHORIZED')
})

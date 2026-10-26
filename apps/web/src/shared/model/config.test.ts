import { describe, expect, it } from 'vitest'
import { getWebConfiguration } from './config'

describe('local API routing', () => {
  it('uses the local API proxy and rejects every other dev target before requests', () => {
    const env = {
      MODE: 'development',
      DEV: true,
      VITE_API_BASE_URL: '/api',
      VITE_USE_MOCKS: 'false',
    }
    expect(getWebConfiguration(env)).toMatchObject({
      API_BASE_URL: '/api',
      IS_DEV: true,
      USE_MOCKS: false,
    })
    for (const address of [
      undefined,
      '',
      'https://api.sadhana-tracker.com',
      'http://user:secret@localhost:8080',
      'http://localhost:8080/path',
      '/test-api',
      'http://127.0.0.1:8080',
    ]) {
      expect(() => getWebConfiguration({ ...env, VITE_API_BASE_URL: address })).toThrow(
        'VITE_API_BASE_URL=/api'
      )
    }
    expect(() => getWebConfiguration({ ...env, VITE_USE_MOCKS: 'true' })).toThrow()
  })
})

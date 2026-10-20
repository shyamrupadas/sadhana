import { randomUUID } from 'node:crypto'
import { request } from '@playwright/test'
import { database } from './database'

export default async function setup() {
  const runId = randomUUID()
  await database('prepare', { runId, ownerPid: process.pid })
  try {
    const account = await database<{ email: string }>('reserve', { runId })
    const password = `E2e-${randomUUID()}`
    const seeded = await database<{ id: string; email: string }>('seed', {
      runId,
      email: account.email,
      password,
    })
    const api = await request.newContext({ baseURL: 'http://localhost:8080' })
    try {
      // A seeded dev account must be visible through this API before any browser writes.
      const response = await api.post('/auth/login', {
        data: { email: account.email, password },
      })
      const body = response.ok() ? await response.json() : null
      if (body?.user?.id !== seeded.id || body?.user?.email !== seeded.email) {
        throw new Error(
          'API на localhost:8080 не подтвердил подключение к выбранной dev-базе. Проверьте запущенный dev API'
        )
      }
    } finally {
      await api.dispose()
    }
    await database('remove', { runId, email: account.email })
  } catch (error) {
    await database('finish', { runId })
    throw error
  }
  process.env.SADHANA_E2E_RUN_ID = runId
  return async () => {
    await database('finish', { runId })
  }
}

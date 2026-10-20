import { randomUUID } from 'node:crypto'
import { test as base, expect, type Page } from '@playwright/test'
import { database } from './database'

type Account = { email: string; password: string }

export const test = base.extend<{ newAccount: Account; account: Account }>({
  newAccount: async ({ baseURL }, provide) => {
    if (baseURL !== 'http://localhost:5173')
      throw new Error('E2E использует только локальный dev-web')
    const runId = process.env.SADHANA_E2E_RUN_ID
    if (!runId) throw new Error('E2E должен запускаться с подготовкой dev-базы')
    const { email } = await database<{ email: string }>('reserve', { runId })
    try {
      await provide({ email, password: `E2e-${randomUUID()}` })
    } finally {
      await database('remove', { runId, email })
    }
  },
  account: async ({ newAccount }, provide) => {
    await database('seed', { runId: process.env.SADHANA_E2E_RUN_ID, ...newAccount })
    await provide(newAccount)
  },
})

export { expect }

export async function login(page: Page, account: Account) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(account.email)
  await page.getByLabel('Пароль', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page).toHaveURL('/')
}

import { expect, test, type Page } from '@playwright/test'
import type { ApiSchemas } from '@sadhana/api-contract'

const email = 'user@example.com'
const password = 'sadhana-password'
const token = `header.${Buffer.from(
  JSON.stringify({ exp: 4_102_444_800, userId: 'user-1', email })
).toString('base64url')}.signature`

const mockAccessApi = async (page: Page, operation?: 'register' | 'login') => {
  const unexpected: string[] = []
  const respond = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })

  await page.route('**/test-api/**', async (route) => {
    const request = route.request()
    const { pathname, search } = new URL(request.url())
    const path = `${pathname}${search}`
    const method = request.method()

    if (operation && method === 'POST' && path === `/test-api/auth/${operation}`) {
      const body = request.postDataJSON() as ApiSchemas['LoginRequest']
      expect(body.email).toBe(email)
      expect(body.password).toBe(password)
      await route.fulfill(
        respond(
          {
            accessToken: token,
            user: { id: 'user-1', email },
          } satisfies ApiSchemas['AuthResponse'],
          operation === 'register' ? 201 : 200
        )
      )
      return
    }
    if (method === 'GET' && path === '/test-api/habits') {
      await route.fulfill(respond([] satisfies ApiSchemas['HabitDefinition'][]))
      return
    }
    if (method === 'GET' && path === '/test-api/sleep-records') {
      await route.fulfill(respond([] satisfies ApiSchemas['DailyEntry'][]))
      return
    }

    unexpected.push(`${method} ${path}`)
    await route.fulfill(
      respond({ code: 'UNEXPECTED_REQUEST', message: `${method} ${path}` }, 501)
    )
  })

  return unexpected
}

test('перенаправляет гостя с защищённой страницы на вход', async ({ page }) => {
  const unexpected = await mockAccessApi(page)

  await page.goto('/settings')

  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Настройки', exact: true })
  ).not.toBeVisible()
  expect(unexpected).toEqual([])
})

test('регистрирует нового пользователя и открывает главную страницу', async ({
  page,
}) => {
  const unexpected = await mockAccessApi(page, 'register')

  await page.goto('/login')
  await page.getByRole('link', { name: 'Зарегистрироваться', exact: true }).click()
  await expect(page).toHaveURL('/register')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByLabel('Подтвердите пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Садхана', exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: /Подъём/ })).toBeVisible()
  expect(unexpected).toEqual([])
})

test('входит, выходит и закрывает повторный доступ к защищённой странице', async ({
  page,
}) => {
  const unexpected = await mockAccessApi(page, 'login')

  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Садхана', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Ещё', exact: true }).click()
  await expect(page).toHaveURL('/settings')
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()

  await page.goto('/settings')
  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Настройки', exact: true })
  ).not.toBeVisible()
  expect(unexpected).toEqual([])
})

import { test, expect, login } from './fixtures'

test('регистрирует аккаунт, открывает приложение и позволяет войти с этими данными', async ({
  page,
  browser,
  newAccount,
}) => {
  await page.goto('/register')
  await page.getByLabel('Email', { exact: true }).fill(newAccount.email)
  await page.getByLabel('Пароль', { exact: true }).fill(newAccount.password)
  await page.getByLabel('Подтвердите пароль').fill(newAccount.password)
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Садхана', exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: /Подъём/ })).toBeVisible()

  const freshContext = await browser.newContext({ baseURL: 'http://localhost:5173' })
  try {
    const freshPage = await freshContext.newPage()
    await login(freshPage, newAccount)
    await freshPage.getByRole('link', { name: 'Ещё', exact: true }).click()
    await expect(freshPage.getByText(newAccount.email, { exact: true })).toBeVisible()
  } finally {
    await freshContext.close()
  }
})

test('входит и выходит из существующего аккаунта', async ({ page, account }) => {
  await login(page, account)
  await page.getByRole('link', { name: 'Ещё', exact: true }).click()
  await expect(page).toHaveURL('/settings')
  await expect(page.getByText(account.email, { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page).toHaveURL('/login')
  await page.goto('/settings')
  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
})

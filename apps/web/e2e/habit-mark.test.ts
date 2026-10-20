import type { ApiSchemas } from '@sadhana/api-contract'
import { test, expect, login } from './fixtures'

test('создаёт привычку и сохраняет полный цикл отметки дня', async ({
  page,
  account,
}) => {
  await login(page, account)
  await page.getByRole('button', { name: 'Режим редактирования' }).click()
  await page.getByPlaceholder('Новая привычка').fill('Чтение')
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/habits'
  )
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  const response = await created
  expect(response.ok()).toBe(true)
  const habit: ApiSchemas['HabitDefinition'] = await response.json()
  const row = page.getByRole('row', { name: /Чтение/ })
  await expect(row).toBeVisible()
  await page.getByRole('button', { name: 'Выйти из режима редактирования' }).click()
  const dayCell = row.getByRole('cell').last()

  for (const [before, after] of [
    ['Не отмечено', 'Выполнено'],
    ['Выполнено', 'Не выполнено'],
    ['Не выполнено', 'Не отмечено'],
  ] as const) {
    const method = after === 'Не отмечено' ? 'DELETE' : 'PATCH'
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === method &&
        decodeURIComponent(new URL(response.url()).pathname).endsWith(
          `/habits/${habit.key}`
        )
    )
    await dayCell.getByRole('button', { name: before, exact: true }).click()
    expect((await saved).ok()).toBe(true)
    await expect(dayCell.getByRole('button', { name: after, exact: true })).toBeVisible()
    await page.reload()
    await expect(dayCell.getByRole('button', { name: after, exact: true })).toBeVisible()
  }
})

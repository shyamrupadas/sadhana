import type { ApiSchemas } from '@sadhana/api-contract'
import { test, expect, login } from './fixtures'

test('сохраняет отметки, статистику и одну историю при архивировании и возврате', async ({
  page,
  account,
}) => {
  test.setTimeout(120_000)
  await login(page, account)
  await page.getByRole('button', { name: 'Режим редактирования' }).click()
  await page.getByPlaceholder('Новая привычка').fill('Чтение')
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/habits'
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
  await dayCell.getByRole('button', { name: 'Не отмечено', exact: true }).click()
  await expect(dayCell.getByRole('button', { name: 'Выполнено', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Статистика', exact: true }).click()
  const statisticsRow = page.getByRole('row', { name: /Чтение/ })
  await expect(statisticsRow.getByLabel('Выполнено', { exact: true })).toBeVisible()
  for (const scale of ['Недели', 'Месяцы', 'Годы']) {
    await page.getByRole('button', { name: scale, exact: true }).click()
    await expect(statisticsRow).toContainText('100%')
  }
  await page.getByRole('link', { name: 'Главная', exact: true }).click()
  await page.getByRole('button', { name: 'Режим редактирования' }).click()
  await page.getByRole('button', { name: 'Меню привычки: Чтение' }).click()
  const renameDialog = page.waitForEvent('dialog').then(async dialog => {
    expect(dialog.type()).toBe('prompt')
    await dialog.accept('Книги')
  })
  await page.getByRole('button', { name: 'Переименовать: Чтение' }).click()
  await renameDialog
  await expect(page.getByRole('row', { name: /Книги/ })).toBeVisible()
  await page.getByRole('button', { name: 'В архив: Книги' }).click()
  await expect(page.getByText('Привычка перенесена в архив')).toBeVisible()
  await expect(page.getByRole('row', { name: /Книги/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Отменить', exact: true }).click()
  await expect(page.getByRole('row', { name: /Книги/ })).toBeVisible()
  await page.getByRole('button', { name: 'Меню привычки: Книги' }).click()
  await page.getByRole('button', { name: 'В архив: Книги' }).click()
  await expect(page.getByRole('row', { name: /Книги/ })).toHaveCount(0)
  await page.getByRole('link', { name: 'Статистика', exact: true }).click()
  await expect(page.getByRole('row', { name: /Книги/ })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Показывать архивные' }).check()
  await expect(page.getByRole('row', { name: /Книги/ }).getByLabel('Выполнено', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Главная', exact: true }).click()
  await page.getByRole('button', { name: 'Архив', exact: true }).click()
  await page.getByRole('link', { name: 'История: Книги' }).click()
  await expect(page).toHaveURL(`/statistics?habitId=${habit.key}`)
  await expect(page.getByRole('row', { name: /Книги/ })).toBeVisible()
  await page.getByRole('link', { name: 'К привычкам' }).click()
  await page.getByRole('button', { name: 'Архив', exact: true }).click()
  await page.getByRole('button', { name: 'Вернуть: Книги' }).click()
  await expect(page.getByRole('row', { name: /Книги/ })).toBeVisible()
  await page.getByRole('button', { name: 'Режим редактирования' }).click()
  await page.getByRole('button', { name: 'Меню привычки: Книги' }).click()
  let confirmations = 0
  const deletionDialog = page.waitForEvent('dialog').then(async dialog => {
    confirmations++
    expect(dialog.message()).toBe('Удалить “Книги” и все 1 отметки? Восстановить их будет нельзя')
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'Удалить навсегда: Книги' }).click()
  await deletionDialog
  await expect(page.getByRole('row', { name: /Книги/ })).toHaveCount(0)
  expect(confirmations).toBe(1)
  await page.getByPlaceholder('Новая привычка').fill('Книги')
  const recreatedResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/habits')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  const recreated: ApiSchemas['HabitDefinition'] = await (await recreatedResponse).json()
  expect(recreated.key).not.toBe(habit.key)
  await page.getByRole('button', { name: 'Выйти из режима редактирования' }).click()
  await expect(page.getByRole('row', { name: /Книги/ }).getByRole('cell').last().getByRole('button', { name: 'Не отмечено', exact: true })).toBeVisible()

})

import { expect, test } from '@playwright/test'
import type { ApiSchemas } from '@sadhana/api-contract'

test('создаёт привычку и сохраняет полный цикл отметки дня', async ({ page }) => {
  const token = `header.${Buffer.from(JSON.stringify({ exp: 4_102_444_800, userId: 'user-1' })).toString('base64url')}.signature`
  await page.addInitScript((value) => localStorage.setItem('token', value), token)

  const habits: ApiSchemas['HabitDefinition'][] = []
  const entries: ApiSchemas['DailyEntry'][] = []
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

    if (method === 'GET' && path === '/test-api/habits') {
      await route.fulfill(respond(habits))
      return
    }
    if (method === 'POST' && path === '/test-api/habits') {
      const body = request.postDataJSON() as ApiSchemas['HabitInput']
      if (body.label !== 'Чтение') throw new Error(`Неожиданная привычка: ${body.label}`)
      const habit = {
        key: 'reading',
        label: body.label,
        createdAt: '2026-10-01T00:00:00.000Z',
      }
      habits.push(habit)
      await route.fulfill(respond(habit, 201))
      return
    }
    if (method === 'GET' && path === '/test-api/sleep-records') {
      await route.fulfill(respond(entries))
      return
    }

    const markPath = /^\/test-api\/sleep-records\/(\d{4}-\d{2}-\d{2})\/habits\/reading$/
    const match = path.match(markPath)
    if (match && (method === 'PATCH' || method === 'DELETE')) {
      const date = match[1]
      let entry = entries.find((item) => item.id === date)
      if (!entry) {
        entry = {
          id: date,
          date,
          sleep: { bedtime: null, wakeTime: null, napDuration: null, duration: null },
          habits: [],
        }
        entries.push(entry)
      }
      if (method === 'PATCH') {
        const body = request.postDataJSON() as ApiSchemas['DailyHabitMarkInput']
        if (typeof body.value !== 'boolean')
          throw new Error(`Неожиданная отметка: ${JSON.stringify(body)}`)
        entry.habits = [{ key: 'reading', value: body.value }]
      } else {
        entry.habits = []
      }
      await route.fulfill(respond(entry))
      return
    }

    unexpected.push(`${method} ${path}`)
    await route.fulfill(
      respond({ code: 'UNEXPECTED_REQUEST', message: `${method} ${path}` }, 501)
    )
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Режим редактирования' }).click()
  await page.getByPlaceholder('Новая привычка').fill('Чтение')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
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
    const saved = page.waitForResponse((response) => {
      const { pathname, search } = new URL(response.url())
      return (
        response.request().method() === method &&
        /^\/test-api\/sleep-records\/\d{4}-\d{2}-\d{2}\/habits\/reading$/.test(
          `${pathname}${search}`
        )
      )
    })
    await dayCell.getByRole('button', { name: before, exact: true }).click()
    await expect(dayCell.getByRole('button', { name: after, exact: true })).toBeVisible()
    expect((await saved).ok()).toBe(true)
    await page.reload()
    await expect(dayCell.getByRole('button', { name: after, exact: true })).toBeVisible()
  }

  expect(unexpected).toEqual([])
})

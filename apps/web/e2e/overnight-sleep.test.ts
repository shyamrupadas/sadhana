import { expect, test } from '@playwright/test'
import type { ApiSchemas } from '@sadhana/api-contract'

test.use({ timezoneId: 'Europe/Moscow' })

test('сохраняет вечерний отбой и утренний подъём через полночь', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-09T12:00:00+03:00'))
  const token = `header.${Buffer.from(JSON.stringify({ exp: 4_102_444_800, userId: 'user-1' })).toString('base64url')}.signature`
  await page.addInitScript((value) => localStorage.setItem('token', value), token)

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
    const method = request.method()

    if (!search && method === 'GET' && pathname === '/test-api/habits') {
      await route.fulfill(respond([]))
      return
    }
    if (!search && method === 'GET' && pathname === '/test-api/sleep-records') {
      await route.fulfill(respond(entries))
      return
    }
    if (
      !search &&
      method === 'PUT' &&
      (pathname === '/test-api/sleep-records/2026-10-08' ||
        pathname === '/test-api/sleep-records/2026-10-09')
    ) {
      const date = pathname.slice('/test-api/sleep-records/'.length)
      const body = request.postDataJSON() as ApiSchemas['SleepDataInput']
      expect(body, `Данные сна за ${date}`).toEqual(
        date === '2026-10-08'
          ? { bedtime: '2026-10-08 23:15', wakeTime: null, napDuration: null }
          : { bedtime: null, wakeTime: '2026-10-09 07:30', napDuration: null }
      )

      // Сервер считает ночь по отбою предыдущего дня; его расчёт покрыт API-тестами.
      const hasEvening = entries.some(
        (entry) => entry.sleep.bedtime === '2026-10-08 23:15'
      )
      const entry: ApiSchemas['DailyEntry'] = {
        id: date,
        date,
        sleep: {
          bedtime: body.bedtime ?? null,
          wakeTime: body.wakeTime ?? null,
          napDuration: body.napDuration,
          duration: date === '2026-10-09' && hasEvening ? 495 : null,
        },
        habits: [],
      }
      const index = entries.findIndex((item) => item.id === date)
      if (index === -1) entries.push(entry)
      else entries[index] = entry
      await route.fulfill(respond(entry))
      return
    }

    unexpected.push(`${method} ${pathname}${search}`)
    await route.fulfill(
      respond({ code: 'UNEXPECTED_REQUEST', message: unexpected.at(-1) }, 501)
    )
  })

  await page.goto('/')
  await expect(
    page.getByRole('columnheader', { name: '09.10', exact: true })
  ).toBeVisible()
  const headers = await page.getByRole('columnheader').allTextContents()
  const eveningColumn = headers.indexOf('08.10')
  const morningColumn = headers.indexOf('09.10')
  expect(eveningColumn).toBeGreaterThan(0)
  expect(morningColumn).toBeGreaterThan(eveningColumn)

  for (const [rowName, column, time, date] of [
    ['Отбой', eveningColumn, '23:15', '2026-10-08'],
    ['Подъём', morningColumn, '07:30', '2026-10-09'],
  ] as const) {
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === `/test-api/sleep-records/${date}`
    )
    await page
      .getByRole('row', { name: rowName })
      .getByRole('cell')
      .nth(column)
      .getByRole('button')
      .click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: time, exact: true })
      .nth(1)
      .click()
    expect((await saved).ok()).toBe(true)
    await expect(
      page
        .getByRole('row', { name: rowName })
        .getByRole('cell')
        .nth(column)
        .getByRole('button', { name: time, exact: true })
    ).toBeVisible()
  }

  await page.reload()
  await expect(
    page
      .getByRole('row', { name: 'Отбой' })
      .getByRole('cell')
      .nth(eveningColumn)
      .getByRole('button', { name: '23:15', exact: true })
  ).toBeVisible()
  await expect(
    page
      .getByRole('row', { name: 'Подъём' })
      .getByRole('cell')
      .nth(morningColumn)
      .getByRole('button', { name: '07:30', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('row', { name: 'Сон (итого)' }).getByRole('cell').nth(morningColumn)
  ).toHaveText('8:15')
  expect(unexpected).toEqual([])
})

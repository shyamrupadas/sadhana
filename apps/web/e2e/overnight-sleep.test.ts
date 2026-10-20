import { test, expect, login } from './fixtures'

test('сохраняет вечерний отбой и утренний подъём через полночь', async ({
  page,
  account,
}) => {
  // Both days stay inside the API's five-day window even if the test crosses midnight.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(
    new Date()
  )
  const morning = new Date(`${today}T12:00:00Z`)
  morning.setUTCDate(morning.getUTCDate() - 1)
  const morningDate = morning.toISOString().slice(0, 10)
  morning.setUTCDate(morning.getUTCDate() - 1)
  const eveningDate = morning.toISOString().slice(0, 10)
  const label = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`

  await login(page, account)
  await expect(
    page.getByRole('columnheader', { name: label(morningDate), exact: true })
  ).toBeVisible()
  const headers = await page.getByRole('columnheader').allTextContents()
  const eveningColumn = headers.indexOf(label(eveningDate))
  const morningColumn = headers.indexOf(label(morningDate))
  expect(eveningColumn).toBeGreaterThan(0)
  expect(morningColumn).toBeGreaterThan(eveningColumn)

  for (const [rowName, column, time, date] of [
    ['Отбой', eveningColumn, '23:15', eveningDate],
    ['Подъём', morningColumn, '07:30', morningDate],
  ] as const) {
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === `/sleep-records/${date}`
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
})

/// <reference lib="dom" />
import { test, expect, login } from './fixtures'

test('просматривает длинную историю с ограниченным DOM и повторно загружает дальние блоки', async ({
  page,
  account,
}) => {
  const auth = await page.request.post('http://localhost:8080/auth/login', {
    data: account,
  })
  expect(auth.ok()).toBe(true)
  const { accessToken } = await auth.json()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(
    new Date()
  )
  const oldest = `${Number(today.slice(0, 4)) - 20}-${today.slice(5)}`
  for (const date of [oldest, today]) {
    const saved = await page.request.put(`http://localhost:8080/sleep-records/${date}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      data: { wakeTime: `${date} 07:00`, napDuration: 30 },
    })
    expect(saved.ok()).toBe(true)
  }
  await login(page, account)
  const requested: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/statistics') requested.push(request.url())
  })
  await page.goto('/statistics')
  const history = page.getByRole('region', { name: 'История сна' })
  const table = page.getByRole('table', { name: 'Статистика сна' })
  await expect(page.getByRole('row', { name: /Подъём/ })).toContainText('07:00')
  const initialRequests = () =>
    requested.filter((url) => new URL(url).searchParams.get('toExclusive')! > today)
      .length
  const before = initialRequests()
  const first = await history.evaluate((element) => (element as HTMLElement).scrollLeft)
  for (let block = 0; block < 5; block++) {
    const lastColumn = Number(
      await table.getByRole('columnheader').last().getAttribute('aria-colindex')
    )
    await history.evaluate((element) => {
      ;(element as HTMLElement).scrollLeft -= 48 * 48
    })
    await expect
      .poll(async () =>
        Number(await table.getByRole('columnheader').last().getAttribute('aria-colindex'))
      )
      .toBeLessThan(lastColumn)
    await expect(history.getByRole('status')).toHaveCount(0)
    await expect(history.getByRole('alert')).toHaveCount(0)
  }
  expect(
    await history.evaluate((element) => (element as HTMLElement).scrollLeft)
  ).toBeLessThan(first - 48 * 100)
  const metrics = await history.evaluate((element) => ({
    width: (element as HTMLElement).clientWidth,
    rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
  }))
  expect(await table.getByRole('columnheader').count()).toBeLessThanOrEqual(
    Math.ceil((metrics.width - metrics.rem * 5.5) / (metrics.rem * 3)) + 8
  )
  await page.getByRole('button', { name: 'К сегодня' }).click()
  await expect.poll(initialRequests).toBeGreaterThan(before)
  await expect(page.getByRole('row', { name: /Подъём/ })).toContainText('07:00')
  await page.getByRole('button', { name: 'Годы', exact: true }).click()
  await expect(table).toHaveAttribute('aria-colcount', '22')
  await expect(history.getByRole('status')).toHaveCount(0)
  await expect(page.getByRole('row', { name: /Подъём/ })).toContainText('07:00')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Дни', exact: true }).click()
  await expect(page.getByRole('row', { name: /Подъём/ })).toContainText('07:00')
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true)
  await history.focus()
  const right = await history.evaluate((element) => (element as HTMLElement).scrollLeft)
  await page.keyboard.press('ArrowLeft')
  await expect
    .poll(() => history.evaluate((element) => (element as HTMLElement).scrollLeft))
    .toBeLessThan(right)
  const bounds = await history.boundingBox()
  await page.mouse.move(bounds!.x + 200, bounds!.y + 80)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + 300, bounds!.y + 80)
  await page.mouse.up()
  await expect
    .poll(() => history.evaluate((element) => (element as HTMLElement).scrollLeft))
    .toBeLessThan(right - 80)
})

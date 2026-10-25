import { BadRequestError } from './errors'

export type Granularity = 'day' | 'week' | 'month' | 'year'
export const blockLimits: Record<Granularity, number> = {
  day: 48,
  week: 24,
  month: 12,
  year: 4,
}

export function calendarDate(value: string): Date {
  const date = new Date(`${value}T00:00:00Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(+date) ||
    date.toISOString().slice(0, 10) !== value ||
    value < '0002-01-01' ||
    value > '9998-12-31'
  ) {
    throw new BadRequestError(
      'Expected a valid calendar date between years 0002 and 9998'
    )
  }
  return date
}

export function addDays(value: string, count: number): string {
  const date = calendarDate(value)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

export function periodStart(value: string, granularity: Granularity): string {
  const date = calendarDate(value)
  if (granularity === 'week')
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  if (granularity === 'month' || granularity === 'year') date.setUTCDate(1)
  if (granularity === 'year') date.setUTCMonth(0)
  return date.toISOString().slice(0, 10)
}

export function nextPeriod(value: string, granularity: Granularity): string {
  const date = calendarDate(value)
  if (granularity === 'day' || granularity === 'week')
    date.setUTCDate(date.getUTCDate() + (granularity === 'week' ? 7 : 1))
  if (granularity === 'month') date.setUTCMonth(date.getUTCMonth() + 1)
  if (granularity === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1)
  return date.toISOString().slice(0, 10)
}

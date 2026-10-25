import dayjs from 'dayjs'
import type { ApiSchemas } from '@sadhana/api-contract'

export type Granularity = ApiSchemas['StatisticsData']['granularity']
export const blockSize: Record<Granularity, number> = {
  day: 48,
  week: 24,
  month: 12,
  year: 4,
}
export const scales: [Granularity, string][] = [
  ['day', 'Дни'],
  ['week', 'Недели'],
  ['month', 'Месяцы'],
  ['year', 'Годы'],
]

export function periodStart(date: string, granularity: Granularity): string {
  const value = dayjs(date)
  return (
    granularity === 'week'
      ? value.subtract((value.day() + 6) % 7, 'day')
      : value.startOf(granularity)
  ).format('YYYY-MM-DD')
}

export function movePeriod(
  date: string,
  amount: number,
  granularity: Granularity
): string {
  return dayjs(date).add(amount, granularity).format('YYYY-MM-DD')
}

export function periodDistance(
  from: string,
  to: string,
  granularity: Granularity
): number {
  return dayjs(to).diff(dayjs(from), granularity)
}

export function periodLabel(date: string, granularity: Granularity): string {
  return dayjs(date).format(
    granularity === 'year' ? 'YYYY' : granularity === 'month' ? 'MM.YY' : 'DD.MM'
  )
}

export function formatMinutes(value: number | null, clock = false): string {
  if (value === null) return '—'
  return `${String(Math.floor(value / 60)).padStart(clock ? 2 : 1, '0')}:${String(value % 60).padStart(2, '0')}`
}

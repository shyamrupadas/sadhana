import { useQuery } from '@tanstack/react-query'
import { ArrowUp, ArrowDown } from 'lucide-react'

import { sleepApi } from '../sleepApi'

const QUERY_KEY = ['sleepStats']

const getMinutesDifference = (time1: string | null, time2: string | null): number => {
  if (!time1 || !time2) return 0

  const [h1, m1] = time1.split(':').map(Number)
  const [h2, m2] = time2.split(':').map(Number)

  return h2 * 60 + m2 - (h1 * 60 + m1)
}

const getDurationDifference = (
  duration1: string | null,
  duration2: string | null
): number => {
  if (!duration1 || !duration2) return 0

  const [h1, m1] = duration1.split(':').map(Number)
  const [h2, m2] = duration2.split(':').map(Number)

  return h2 * 60 + m2 - (h1 * 60 + m1)
}

export const useSleepStats = () => {
  const sleepStatsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: sleepApi.getSleepStats,
    select: (data) => {
      // Сравнение месяца с годом (для стрелок в столбце "30 дней")
      const monthVsYearBedtime = getMinutesDifference(
        data.year.bedtime,
        data.month.bedtime
      )
      const monthVsYearWake = getMinutesDifference(
        data.year.wakeTime,
        data.month.wakeTime
      )
      const monthVsYearSleep = getDurationDifference(
        data.year.duration,
        data.month.duration
      )

      // Сравнение недели с месяцем (для стрелок в столбце "Неделя")
      const weekVsMonthBedtime = getMinutesDifference(
        data.month.bedtime,
        data.week.bedtime
      )
      const weekVsMonthWake = getMinutesDifference(
        data.month.wakeTime,
        data.week.wakeTime
      )
      const weekVsMonthSleep = getDurationDifference(
        data.month.duration,
        data.week.duration
      )

      return {
        bedtime: {
          year: data.year.bedtime || '—',
          month: data.month.bedtime || '—',
          monthArrow: monthVsYearBedtime < 0 ? ArrowDown : ArrowUp,
          monthColor: monthVsYearBedtime < 0 ? 'text-green-600' : 'text-red-600',
          week: data.week.bedtime || '—',
          weekArrow: weekVsMonthBedtime < 0 ? ArrowDown : ArrowUp,
          weekColor: weekVsMonthBedtime < 0 ? 'text-green-600' : 'text-red-600',
        },
        wakeTime: {
          year: data.year.wakeTime || '—',
          month: data.month.wakeTime || '—',
          monthArrow: monthVsYearWake < 0 ? ArrowDown : ArrowUp,
          monthColor: monthVsYearWake < 0 ? 'text-green-600' : 'text-red-600',
          week: data.week.wakeTime || '—',
          weekArrow: weekVsMonthWake < 0 ? ArrowDown : ArrowUp,
          weekColor: weekVsMonthWake < 0 ? 'text-green-600' : 'text-red-600',
        },
        sleep: {
          year: data.year.duration || '—',
          month: data.month.duration || '—',
          monthArrow: monthVsYearSleep > 0 ? ArrowUp : ArrowDown,
          monthColor: monthVsYearSleep > 0 ? 'text-green-600' : 'text-red-600',
          week: data.week.duration || '—',
          weekArrow: weekVsMonthSleep > 0 ? ArrowUp : ArrowDown,
          weekColor: weekVsMonthSleep > 0 ? 'text-green-600' : 'text-red-600',
        },
      }
    },
  })

  return {
    sleepStatsQuery,
  }
}

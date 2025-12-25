import { ArrowUp, ArrowDown } from 'lucide-react'

import { rqClient } from '@/shared/api/instance'
import { ApiShemas } from '@/shared/api/schema'

type TransformedSleepStats = {
  bedtime: {
    year: string
    month: string
    monthArrow: typeof ArrowDown | typeof ArrowUp
    monthColor: string
    week: string
    weekArrow: typeof ArrowDown | typeof ArrowUp
    weekColor: string
  }
  wakeTime: {
    year: string
    month: string
    monthArrow: typeof ArrowDown | typeof ArrowUp
    monthColor: string
    week: string
    weekArrow: typeof ArrowDown | typeof ArrowUp
    weekColor: string
  }
  sleep: {
    year: string
    month: string
    monthArrow: typeof ArrowDown | typeof ArrowUp
    monthColor: string
    week: string
    weekArrow: typeof ArrowDown | typeof ArrowUp
    weekColor: string
  }
}

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

const getDefaultStats = (): TransformedSleepStats => ({
  bedtime: {
    year: '—',
    month: '—',
    monthArrow: ArrowUp,
    monthColor: 'text-gray-600',
    week: '—',
    weekArrow: ArrowUp,
    weekColor: 'text-gray-600',
  },
  wakeTime: {
    year: '—',
    month: '—',
    monthArrow: ArrowUp,
    monthColor: 'text-gray-600',
    week: '—',
    weekArrow: ArrowUp,
    weekColor: 'text-gray-600',
  },
  sleep: {
    year: '—',
    month: '—',
    monthArrow: ArrowUp,
    monthColor: 'text-gray-600',
    week: '—',
    weekArrow: ArrowUp,
    weekColor: 'text-gray-600',
  },
})

const transformStatsData = (
  rawData: ApiShemas['SleepStatsResponse']
): TransformedSleepStats => {
  const monthVsYearBedtime = getMinutesDifference(
    rawData.year?.bedtime ?? null,
    rawData.month?.bedtime ?? null
  )
  const monthVsYearWake = getMinutesDifference(
    rawData.year?.wakeTime ?? null,
    rawData.month?.wakeTime ?? null
  )
  const monthVsYearSleep = getDurationDifference(
    rawData.year?.duration ?? null,
    rawData.month?.duration ?? null
  )

  const weekVsMonthBedtime = getMinutesDifference(
    rawData.month?.bedtime ?? null,
    rawData.week?.bedtime ?? null
  )
  const weekVsMonthWake = getMinutesDifference(
    rawData.month?.wakeTime ?? null,
    rawData.week?.wakeTime ?? null
  )
  const weekVsMonthSleep = getDurationDifference(
    rawData.month?.duration ?? null,
    rawData.week?.duration ?? null
  )

  return {
    bedtime: {
      year: rawData.year?.bedtime || '—',
      month: rawData.month?.bedtime || '—',
      monthArrow: monthVsYearBedtime < 0 ? ArrowDown : ArrowUp,
      monthColor: monthVsYearBedtime < 0 ? 'text-green-600' : 'text-red-600',
      week: rawData.week?.bedtime || '—',
      weekArrow: weekVsMonthBedtime < 0 ? ArrowDown : ArrowUp,
      weekColor: weekVsMonthBedtime < 0 ? 'text-green-600' : 'text-red-600',
    },
    wakeTime: {
      year: rawData.year?.wakeTime || '—',
      month: rawData.month?.wakeTime || '—',
      monthArrow: monthVsYearWake < 0 ? ArrowDown : ArrowUp,
      monthColor: monthVsYearWake < 0 ? 'text-green-600' : 'text-red-600',
      week: rawData.week?.wakeTime || '—',
      weekArrow: weekVsMonthWake < 0 ? ArrowDown : ArrowUp,
      weekColor: weekVsMonthWake < 0 ? 'text-green-600' : 'text-red-600',
    },
    sleep: {
      year: rawData.year?.duration || '—',
      month: rawData.month?.duration || '—',
      monthArrow: monthVsYearSleep > 0 ? ArrowUp : ArrowDown,
      monthColor: monthVsYearSleep > 0 ? 'text-green-600' : 'text-red-600',
      week: rawData.week?.duration || '—',
      weekArrow: weekVsMonthSleep > 0 ? ArrowUp : ArrowDown,
      weekColor: weekVsMonthSleep > 0 ? 'text-green-600' : 'text-red-600',
    },
  }
}

export const useSleepStats = () => {
  const defaultStats = getDefaultStats()

  const sleepStatsQuery = rqClient.useQuery('get', '/sleep-stats')

  const data: TransformedSleepStats = sleepStatsQuery.data
    ? transformStatsData(sleepStatsQuery.data)
    : defaultStats

  return {
    sleepStatsQuery: {
      data,
      isLoading: sleepStatsQuery.isLoading,
      isError: sleepStatsQuery.isError,
      error: sleepStatsQuery.error,
    },
  }
}

import { useQuery } from '@tanstack/react-query'
import { ArrowUp, ArrowDown } from 'lucide-react'

import { sleepApi } from '../sleepApi'

const QUERY_KEY = ['sleepStats']

const formatTimeDifference = (minutes: number): string => {
  const absMinutes = Math.abs(minutes)
  const hours = Math.floor(absMinutes / 60)
  const mins = absMinutes % 60

  return `${hours}:${String(mins).padStart(2, '0')}`
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

export const useSleepStats = () => {
  const sleepStatsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: sleepApi.getSleepStats,
    select: (data) => {
      const bedtimeDiff = getMinutesDifference(data.year.bedtime, data.month.bedtime)
      const wakeDiff = getMinutesDifference(data.year.wakeTime, data.month.wakeTime)
      const sleepDiff = getDurationDifference(data.year.duration, data.month.duration)

      return {
        bedtime: {
          year: data.year.bedtime || '—',
          month: data.month.bedtime || '—',
          difference: formatTimeDifference(bedtimeDiff),
          isImprovement: bedtimeDiff < 0,
          arrow: bedtimeDiff < 0 ? ArrowDown : ArrowUp,
          color: bedtimeDiff < 0 ? 'text-green-600' : 'text-red-600',
        },
        wakeTime: {
          year: data.year.wakeTime || '—',
          month: data.month.wakeTime || '—',
          difference: formatTimeDifference(wakeDiff),
          isImprovement: wakeDiff < 0,
          arrow: wakeDiff < 0 ? ArrowDown : ArrowUp,
          color: wakeDiff < 0 ? 'text-green-600' : 'text-red-600',
        },
        sleep: {
          year: data.year.duration || '—',
          month: data.month.duration || '—',
          difference: formatTimeDifference(sleepDiff),
          isImprovement: sleepDiff > 0,
          arrow: sleepDiff > 0 ? ArrowUp : ArrowDown,
          color: sleepDiff > 0 ? 'text-green-600' : 'text-red-600',
        },
      }
    },
  })

  return {
    sleepStatsQuery,
  }
}


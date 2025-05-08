import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { sleepApi } from '../sleepApi'
import { SleepDataInput } from '../db/sadhanaDB'

const QUERY_KEY = ['sleepRecords']

export const useSleepRecords = () => {
  const queryClient = useQueryClient()

  const sleepRecordsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: sleepApi.getAll,
  })

  const updateSleep = useMutation({
    mutationFn: async ({ id, sleep }: { id: string; sleep: SleepDataInput }) => {
      await sleepApi.updateSleepForDay(id, sleep)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })

  const updateHabit = useMutation({
    mutationFn: async ({
      id,
      key,
      value,
    }: {
      id: string
      key: string
      value: boolean
    }) => {
      await sleepApi.updateHabitForDay(id, key, value)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })

  const removeHabit = useMutation({
    mutationFn: async ({ id, key }: { id: string; key: string }) => {
      await sleepApi.removeHabitForDay(id, key)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })

  return {
    sleepRecordsQuery,
    updateSleep,
    updateHabit,
    removeHabit,
  }
}

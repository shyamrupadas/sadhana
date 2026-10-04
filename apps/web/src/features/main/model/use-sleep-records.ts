import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/instance'
import type { ApiSchemas } from '@sadhana/api-contract'

type OptimisticContext = {
  previousEntries: ApiSchemas['DailyEntry'][]
}

const QUERY_KEY = ['get', '/sleep-records'] as const

const createOptimisticContext = async (
  queryClient: QueryClient,
  queryKey: typeof QUERY_KEY
): Promise<OptimisticContext> => {
  await queryClient.cancelQueries({ queryKey })
  const previousEntries =
    queryClient.getQueryData<ApiSchemas['DailyEntry'][]>(queryKey) ?? []
  return { previousEntries }
}

const rollbackOptimisticUpdate = (
  queryClient: QueryClient,
  queryKey: typeof QUERY_KEY,
  context: OptimisticContext | undefined
) => {
  if (context?.previousEntries) {
    queryClient.setQueryData(queryKey, context.previousEntries)
  }
}

const updateEntrySleep = (
  entries: ApiSchemas['DailyEntry'][],
  date: string,
  sleep: ApiSchemas['SleepDataInput']
): ApiSchemas['DailyEntry'][] => {
  const entryIndex = entries.findIndex((entry) => entry.id === date)

  if (entryIndex >= 0) {
    return entries.map((entry, index) =>
      index === entryIndex
        ? {
            ...entry,
            sleep: {
              ...entry.sleep,
              ...sleep,
              duration: entry.sleep.duration,
            },
          }
        : entry
    )
  }

  const newEntry: ApiSchemas['DailyEntry'] = {
    id: date,
    date,
    sleep: {
      bedtime: sleep.bedtime ?? null,
      wakeTime: sleep.wakeTime ?? null,
      napDuration: sleep.napDuration,
      duration: null,
    },
    habits: [],
  }

  return [...entries, newEntry]
}

const updateEntryHabit = (
  entries: ApiSchemas['DailyEntry'][],
  date: string,
  habitKey: string,
  value: boolean
): ApiSchemas['DailyEntry'][] => {
  const entryIndex = entries.findIndex((entry) => entry.id === date)

  if (entryIndex >= 0) {
    return entries.map((entry, index) => {
      if (index !== entryIndex) return entry

      const habitIndex = entry.habits.findIndex((h) => h.key === habitKey)
      const updatedHabits =
        habitIndex >= 0
          ? entry.habits.map((h, i) => (i === habitIndex ? { ...h, value } : h))
          : [...entry.habits, { key: habitKey, value }]

      return { ...entry, habits: updatedHabits }
    })
  }

  const newEntry: ApiSchemas['DailyEntry'] = {
    id: date,
    date,
    sleep: {
      bedtime: null,
      wakeTime: null,
      napDuration: null,
      duration: null,
    },
    habits: [{ key: habitKey, value }],
  }

  return [...entries, newEntry]
}

const removeEntryHabit = (
  entries: ApiSchemas['DailyEntry'][],
  date: string,
  habitKey: string
): ApiSchemas['DailyEntry'][] => {
  return entries.map((entry) =>
    entry.id === date
      ? { ...entry, habits: entry.habits.filter((h) => h.key !== habitKey) }
      : entry
  )
}

export const useSleepRecords = () => {
  const queryClient = useQueryClient()
  const sleepRecordsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => apiClient.getSleepRecords({ signal }),
  })

  const updateSleep = useMutation({
    mutationFn: ({ date, sleep }: { date: string; sleep: ApiSchemas['SleepDataInput'] }) =>
      apiClient.putSleepRecord(date, sleep),
    onMutate: async ({ date, sleep }): Promise<OptimisticContext> => {
      const context = await createOptimisticContext(queryClient, QUERY_KEY)

      const updatedEntries = updateEntrySleep(context.previousEntries, date, sleep)

      queryClient.setQueryData(QUERY_KEY, updatedEntries)

      return context
    },
    onError: (_error, _variables, onMutateResult) => {
      rollbackOptimisticUpdate(
        queryClient,
        QUERY_KEY,
        onMutateResult as OptimisticContext | undefined
      )
    },
    onSettled: () => {
      sleepRecordsQuery.refetch()
    },
  })

  const updateHabit = useMutation({
    mutationFn: ({
      date,
      habitKey,
      value,
    }: {
      date: string
      habitKey: string
      value: boolean
    }) => apiClient.setDailyHabitMark(date, habitKey, { value }),
    onMutate: async ({ date, habitKey, value }): Promise<OptimisticContext> => {
      const context = await createOptimisticContext(queryClient, QUERY_KEY)

      const updatedEntries = updateEntryHabit(
        context.previousEntries,
        date,
        habitKey,
        value
      )

      queryClient.setQueryData(QUERY_KEY, updatedEntries)

      return context
    },
    onError: (_error, _variables, onMutateResult) => {
      rollbackOptimisticUpdate(
        queryClient,
        QUERY_KEY,
        onMutateResult as OptimisticContext | undefined
      )
    },
    onSettled: () => {
      sleepRecordsQuery.refetch()
    },
  })

  const removeHabit = useMutation({
    mutationFn: ({ date, habitKey }: { date: string; habitKey: string }) =>
      apiClient.removeDailyHabitMark(date, habitKey),
    onMutate: async ({ date, habitKey }): Promise<OptimisticContext> => {
      const context = await createOptimisticContext(queryClient, QUERY_KEY)

      const updatedEntries = removeEntryHabit(context.previousEntries, date, habitKey)

      queryClient.setQueryData(QUERY_KEY, updatedEntries)

      return context
    },
    onError: (_error, _variables, onMutateResult) => {
      rollbackOptimisticUpdate(
        queryClient,
        QUERY_KEY,
        onMutateResult as OptimisticContext | undefined
      )
    },
    onSettled: () => {
      sleepRecordsQuery.refetch()
    },
  })

  return {
    sleepRecordsQuery: {
      data: sleepRecordsQuery.data,
      isLoading: sleepRecordsQuery.isLoading,
      isError: sleepRecordsQuery.isError,
      error: sleepRecordsQuery.error,
    },
    updateSleep: {
      mutate: ({ id, sleep }: { id: string; sleep: ApiSchemas['SleepDataInput'] }) => {
        updateSleep.mutate({ date: id, sleep })
      },
      isPending: updateSleep.isPending,
    },
    updateHabit: {
      mutate: ({ id, key, value }: { id: string; key: string; value: boolean }) => {
        updateHabit.mutate({ date: id, habitKey: key, value })
      },
      isPending: updateHabit.isPending,
    },
    removeHabit: {
      mutate: ({ id, key }: { id: string; key: string }) => {
        removeHabit.mutate({ date: id, habitKey: key })
      },
      isPending: removeHabit.isPending,
    },
  }
}

import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { rqClient } from '@/shared/api/instance'
import { ApiShemas } from '@/shared/api/schema'

type OptimisticContext = {
  previousEntries: ApiShemas['DailyEntry'][]
}

const QUERY_KEY = ['get', '/sleep-records'] as const

const createOptimisticContext = async (
  queryClient: QueryClient,
  queryKey: typeof QUERY_KEY
): Promise<OptimisticContext> => {
  await queryClient.cancelQueries({ queryKey })
  const previousEntries =
    queryClient.getQueryData<ApiShemas['DailyEntry'][]>(queryKey) ?? []
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
  entries: ApiShemas['DailyEntry'][],
  date: string,
  sleep: ApiShemas['SleepDataInput']
): ApiShemas['DailyEntry'][] => {
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

  const newEntry: ApiShemas['DailyEntry'] = {
    id: date,
    date,
    sleep: {
      ...sleep,
      duration: null,
    },
    habits: [],
  }

  return [...entries, newEntry]
}

const updateEntryHabit = (
  entries: ApiShemas['DailyEntry'][],
  date: string,
  habitKey: string,
  value: boolean
): ApiShemas['DailyEntry'][] => {
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

  const newEntry: ApiShemas['DailyEntry'] = {
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
  entries: ApiShemas['DailyEntry'][],
  date: string,
  habitKey: string
): ApiShemas['DailyEntry'][] => {
  return entries.map((entry) =>
    entry.id === date
      ? { ...entry, habits: entry.habits.filter((h) => h.key !== habitKey) }
      : entry
  )
}

export const useSleepRecords = () => {
  const queryClient = useQueryClient()
  const sleepRecordsQuery = rqClient.useQuery('get', '/sleep-records')

  const updateSleep = rqClient.useMutation('put', '/sleep-records/{date}', {
    onMutate: async ({ params, body }): Promise<OptimisticContext> => {
      const context = await createOptimisticContext(queryClient, QUERY_KEY)

      const updatedEntries = updateEntrySleep(
        context.previousEntries,
        params.path.date,
        body
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

  const updateHabit = rqClient.useMutation(
    'patch',
    '/sleep-records/{date}/habits/{habitKey}',
    {
      onMutate: async ({ params, body }): Promise<OptimisticContext> => {
        const context = await createOptimisticContext(queryClient, QUERY_KEY)

        const updatedEntries = updateEntryHabit(
          context.previousEntries,
          params.path.date,
          params.path.habitKey,
          body.value
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
    }
  )

  const removeHabit = rqClient.useMutation(
    'delete',
    '/sleep-records/{date}/habits/{habitKey}',
    {
      onMutate: async ({ params }): Promise<OptimisticContext> => {
        const context = await createOptimisticContext(queryClient, QUERY_KEY)

        const updatedEntries = removeEntryHabit(
          context.previousEntries,
          params.path.date,
          params.path.habitKey
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
    }
  )

  return {
    sleepRecordsQuery: {
      data: sleepRecordsQuery.data,
      isLoading: sleepRecordsQuery.isLoading,
      isError: sleepRecordsQuery.isError,
      error: sleepRecordsQuery.error,
    },
    updateSleep: {
      mutate: ({ id, sleep }: { id: string; sleep: ApiShemas['SleepDataInput'] }) => {
        updateSleep.mutate({
          params: { path: { date: id } },
          body: sleep,
        })
      },
      isPending: updateSleep.isPending,
    },
    updateHabit: {
      mutate: ({ id, key, value }: { id: string; key: string; value: boolean }) => {
        updateHabit.mutate({
          params: { path: { date: id, habitKey: key } },
          body: { value },
        })
      },
      isPending: updateHabit.isPending,
    },
    removeHabit: {
      mutate: ({ id, key }: { id: string; key: string }) => {
        removeHabit.mutate({
          params: { path: { date: id, habitKey: key } },
        })
      },
      isPending: removeHabit.isPending,
    },
  }
}

import { rqClient } from '@/shared/api/instance'
import { ApiShemas } from '@/shared/api/schema'

export const useSleepRecords = () => {
  const sleepRecordsQuery = rqClient.useQuery('get', '/sleep-records')

  const updateSleep = rqClient.useMutation('put', '/sleep-records/{date}', {
    onSuccess: () => {
      sleepRecordsQuery.refetch()
    },
  })

  const updateHabit = rqClient.useMutation(
    'patch',
    '/sleep-records/{date}/habits/{habitKey}',
    {
      onSuccess: () => {
        sleepRecordsQuery.refetch()
      },
    }
  )

  const removeHabit = rqClient.useMutation(
    'delete',
    '/sleep-records/{date}/habits/{habitKey}',
    {
      onSuccess: () => {
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

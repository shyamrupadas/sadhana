import { rqClient } from '@/shared/api/instance'

export const useHabits = () => {
  const habitsQuery = rqClient.useQuery('get', '/habits')

  const addHabit = rqClient.useMutation('post', '/habits', {
    onSuccess: () => {
      habitsQuery.refetch()
    },
  })

  const deleteHabit = rqClient.useMutation('delete', '/habits/{key}', {
    onSuccess: () => {
      habitsQuery.refetch()
    },
  })

  const renameHabit = rqClient.useMutation('patch', '/habits/{key}', {
    onSuccess: () => {
      habitsQuery.refetch()
    },
  })

  return {
    habitsQuery: {
      data: habitsQuery.data,
      isLoading: habitsQuery.isLoading,
      isError: habitsQuery.isError,
      error: habitsQuery.error,
    },
    addHabit: {
      mutate: (label: string) => {
        addHabit.mutate({
          body: { label },
        })
      },
      isPending: addHabit.isPending,
    },
    deleteHabit: {
      mutate: (key: string) => {
        deleteHabit.mutate({
          params: { path: { key } },
        })
      },
      isPending: deleteHabit.isPending,
    },
    renameHabit: {
      mutate: ({ key, newLabel }: { key: string; newLabel: string }) => {
        renameHabit.mutate({
          params: { path: { key } },
          body: { label: newLabel },
        })
      },
      isPending: renameHabit.isPending,
    },
  }
}

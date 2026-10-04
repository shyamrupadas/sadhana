import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/instance'

export const useHabits = () => {
  const habitsQuery = useQuery({
    queryKey: ['get', '/habits'],
    queryFn: ({ signal }) => apiClient.getHabits({ signal }),
  })

  const addHabit = useMutation({
    mutationFn: (label: string) => apiClient.createHabit({ label }),
    onSuccess: () => {
      habitsQuery.refetch()
    },
  })

  const deleteHabit = useMutation({
    mutationFn: (key: string) => apiClient.deleteHabit(key),
    onSuccess: () => {
      habitsQuery.refetch()
    },
  })

  const renameHabit = useMutation({
    mutationFn: ({ key, newLabel }: { key: string; newLabel: string }) =>
      apiClient.updateHabit(key, { label: newLabel }),
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
      mutate: addHabit.mutate,
      isPending: addHabit.isPending,
    },
    deleteHabit: {
      mutate: deleteHabit.mutate,
      isPending: deleteHabit.isPending,
    },
    renameHabit: {
      mutate: renameHabit.mutate,
      isPending: renameHabit.isPending,
    },
  }
}

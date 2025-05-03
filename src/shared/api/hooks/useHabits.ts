import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { habitApi } from '../habitsApi'

const QUERY_KEY = ['habitDefinitions']

export const useHabits = () => {
  const queryClient = useQueryClient()

  const habitsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: habitApi.getAll,
  })

  const addHabit = useMutation({
    mutationFn: async (label: string) => {
      await habitApi.add(label)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })

  const deleteHabit = useMutation({
    mutationFn: async (key: string) => {
      await habitApi.delete(key)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })

  return {
    habitsQuery,
    addHabit,
    deleteHabit,
  }
}

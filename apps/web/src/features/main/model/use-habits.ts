import dayjs from 'dayjs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/instance'
import { getSessionVersion, useSession } from '@/shared/model/session'

export const useHabits = () => {
  const { session } = useSession()
  const userId = session?.userId ?? ''
  const queryClient = useQueryClient()
  const habitsQuery = useQuery({
    queryKey: ['get', '/habits', userId],
    queryFn: ({ signal }) => apiClient.getHabits({ signal }),
    enabled: Boolean(userId),
  })
  const context = () => ({ version: getSessionVersion(), userId })
  const refresh = (_data: unknown, _variables: unknown, current: ReturnType<typeof context> | undefined) => {
    if (!current || current.version !== getSessionVersion()) return
    void queryClient.invalidateQueries({ queryKey: ['get', '/habits', current.userId] })
    void queryClient.invalidateQueries({ queryKey: ['get', '/sleep-records', current.userId] })
    void queryClient.invalidateQueries({ queryKey: ['statistics', current.userId] })
  }
  const addHabit = useMutation({
    mutationFn: (label: string) => apiClient.createHabit({ label, creationDate: dayjs().format('YYYY-MM-DD') }),
    onMutate: context, onSuccess: refresh,
  })
  const deleteHabit = useMutation({ mutationFn: (key: string) => apiClient.deleteHabit(key), onMutate: context, onSuccess: refresh })
  const renameHabit = useMutation({
    mutationFn: ({ key, newLabel }: { key: string; newLabel: string }) => apiClient.updateHabit(key, { label: newLabel }),
    onMutate: context, onSuccess: refresh,
  })
  const archiveHabit = useMutation({ mutationFn: (key: string) => apiClient.archiveHabit(key), onMutate: context, onSuccess: refresh })
  const restoreHabit = useMutation({ mutationFn: (key: string) => apiClient.restoreHabit(key), onMutate: context, onSuccess: refresh })
  return { habitsQuery, addHabit, deleteHabit, renameHabit, archiveHabit, restoreHabit }
}

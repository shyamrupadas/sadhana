import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/instance'

export const useCheckYesterday = () => {
  const checkYesterdayQuery = useQuery({
    queryKey: ['get', '/sleep-records/yesterday/check'],
    queryFn: ({ signal }) => apiClient.checkYesterday({ signal }),
  })

  return {
    checkYesterdaySleep: async (): Promise<boolean> => {
      const result = await checkYesterdayQuery.refetch()
      return result.data?.hasData ?? false
    },
  }
}

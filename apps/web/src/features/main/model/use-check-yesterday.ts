import { rqClient } from '@/shared/api/instance'

export const useCheckYesterday = () => {
  const checkYesterdayQuery = rqClient.useQuery('get', '/sleep-records/yesterday/check')

  return {
    checkYesterdaySleep: async (): Promise<boolean> => {
      const result = await checkYesterdayQuery.refetch()
      return result.data?.hasData ?? false
    },
  }
}

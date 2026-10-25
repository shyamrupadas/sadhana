import { useEffect, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import type { ApiSchemas } from '@sadhana/api-contract'
import { apiClient } from '@/shared/api/instance'
import {
  blockSize,
  movePeriod,
  periodDistance,
  periodStart,
  type Granularity,
} from '@/features/statistics/model/calendar'

export function useStatistics(
  userId: string,
  granularity: Granularity,
  asOfDate: string,
  anchor: string
) {
  const queryClient = useQueryClient()
  const key = (query: { from: string; toExclusive: string }) => [
    'statistics',
    userId,
    granularity,
    query.from,
    query.toExclusive,
    asOfDate,
    false,
    null,
  ]
  const [historyFrom, setHistoryFrom] = useState<string | null>(null)
  const end = movePeriod(periodStart(asOfDate, granularity), 1, granularity)
  const size = blockSize[granularity]
  const center = Math.max(
    0,
    Math.floor(
      (periodDistance(periodStart(anchor, granularity), end, granularity) - 1) / size
    )
  )
  const firstPeriod = periodStart(historyFrom ?? asOfDate, granularity)
  const count = Math.max(1, periodDistance(firstPeriod, end, granularity))
  const lastBlock = historyFrom ? Math.ceil(count / size) - 1 : 0
  const blockStart = Math.max(0, Math.min(center - 1, lastBlock - 2))
  const blocks = [blockStart, blockStart + 1, blockStart + 2].filter(
    (index) => index <= lastBlock
  )
  const ranges = blocks.map((index) => ({
    granularity,
    asOfDate,
    from: historyFrom
      ? [movePeriod(end, -(index + 1) * size, granularity), firstPeriod].sort().at(-1)!
      : movePeriod(end, -size, granularity),
    toExclusive: movePeriod(end, -index * size, granularity),
  }))
  const queries = useQueries({
    queries: ranges.map((query, index) => ({
      queryKey: key(query),
      // Reuse the bootstrap response when learning a shorter history boundary.
      // Its columns already cover the bounded query, so the table never disappears.
      initialData: () => {
        const fullRange = {
          from: movePeriod(end, -(blocks[index] + 1) * size, granularity),
          toExclusive: query.toExclusive,
        }
        const previous = queryClient.getQueryData<ApiSchemas['StatisticsData']>(
          key(fullRange)
        )
        return previous && previous.from <= query.from
          ? {
              ...previous,
              from: query.from,
              columns: previous.columns.filter((column) => column.from >= query.from),
            }
          : undefined
      },
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiClient.getStatistics(query, { signal }),
      enabled: Boolean(userId),
      retry: false,
      staleTime: 60_000,
      gcTime: 0,
    })),
  })
  const latest = queries
    .filter((query) => query.data)
    .sort((a, b) => b.dataUpdatedAt - a.dataUpdatedAt)[0]?.data
  useEffect(() => {
    if (latest) setHistoryFrom(latest.historyFrom)
  }, [latest])
  return { ranges, queries, firstPeriod, count, historyFrom }
}

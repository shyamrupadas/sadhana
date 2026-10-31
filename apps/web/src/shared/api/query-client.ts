import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { isUnexpectedApiError, reportApiError } from '@/shared/lib/unexpected-error'

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (queryClient.getQueryCache().get(query.queryHash) === query)
        reportApiError(error)
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Session changes remove private work from the cache. A late response from
      // that work must not replace the new user's interface with an error screen.
      if (
        queryClient
          .getMutationCache()
          .getAll()
          .some((current) => current === mutation)
      )
        reportApiError(error)
    },
  }),
  defaultOptions: {
    queries: { retry: (count, error) => !isUnexpectedApiError(error) && count < 3 },
    mutations: { retry: false },
  },
})

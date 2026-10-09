import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { vi } from 'vitest'

export function renderWithTestProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

export interface MockApiRequest {
  body?: unknown
  method: string
  path: string
}

export interface MockApiResponse {
  body?: unknown
  status: number
}

export type MockApiHandler = (
  request: MockApiRequest
) => MockApiResponse | Promise<MockApiResponse>

export function mockApi(handler: MockApiHandler) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = new URL(rawUrl, window.location.origin)
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      const response = await handler({
        body,
        method: init?.method ?? 'GET',
        path: url.pathname,
      })
      const headers = new Headers()
      let responseBody: BodyInit | null = null

      if (response.body !== undefined) {
        headers.set('Content-Type', 'application/json')
        responseBody = JSON.stringify(response.body)
      }

      return new Response(responseBody, { headers, status: response.status })
    }
  )

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

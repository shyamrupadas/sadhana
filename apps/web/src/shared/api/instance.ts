import createFetchClient from 'openapi-fetch'
import createClient from 'openapi-react-query'
import { CONFIG } from '@/shared/model/config'
import { ApiPaths, ApiShemas } from './schema'
import { useSession } from '../model/session'

const customFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  return fetch(input, {
    ...init,
    credentials: 'include',
  })
}

export const fetchClient = createFetchClient<ApiPaths>({
  baseUrl: CONFIG.API_BASE_URL,
  fetch: customFetch,
})
export const rqClient = createClient(fetchClient)

export const publicFetchClient = createFetchClient<ApiPaths>({
  baseUrl: CONFIG.API_BASE_URL,
  fetch: customFetch,
})

export const publicRqClient = createClient(publicFetchClient)

fetchClient.use({
  async onRequest({ request }) {
    const session = useSession.getState()
    const token = await session.refreshToken()

    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`)
      return
    }

    if (session.token) {
      return new Response(
        JSON.stringify({
          code: 'TEMPORARILY_UNAVAILABLE',
          message: 'Temporarily unavailable. Please retry.',
        } as ApiShemas['Error']),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        code: 'NOT_AUTHORIZED',
        message: 'You are not authorized to access the resource',
      } as ApiShemas['Error']),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  },
})

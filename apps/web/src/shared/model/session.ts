import { useState } from 'react'
import { jwtDecode } from 'jwt-decode'
import { createGStore } from 'create-gstore'
import { ApiClientError } from '@sadhana/api-contract'
import { publicApiClient } from '../api/instance'
import { queryClient } from '@/shared/api/query-client'

type Session = {
  userId: string
  email: string
  exp: number
  iat: number
}

const TOKEN_KEY = 'token'

const isInvalidRefreshStatus = (status: number): boolean =>
  status === 401 || status === 403

let refreshTokenPromise: Promise<string | null> | null = null
let sessionVersion = 0
export const getSessionVersion = () => sessionVersion

function clearPrivateQueries() {
  sessionVersion++
  refreshTokenPromise = null
  void queryClient.cancelQueries()
  queryClient.clear()
}

const decodeSession = (token: string): Session | null => {
  try {
    return jwtDecode<Session>(token)
  } catch {
    return null
  }
}

export const useSession = createGStore(() => {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))

  const login = (nextToken: string) => {
    if (
      decodeSession(nextToken)?.userId !==
      (token ? decodeSession(token)?.userId : undefined)
    )
      clearPrivateQueries()
    localStorage.setItem(TOKEN_KEY, nextToken)
    setToken(nextToken)
  }

  const logout = () => {
    clearPrivateQueries()
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }

  const session = token ? decodeSession(token) : null

  const performRefresh = async (): Promise<string | null> => {
    const version = sessionVersion
    try {
      const data = await publicApiClient.refresh()
      if (version !== sessionVersion) return null
      const newToken = data?.accessToken ?? null

      if (newToken) {
        login(newToken)
        return newToken
      }

      logout()
      return null
    } catch (error) {
      if (version !== sessionVersion) return null
      if (error instanceof ApiClientError && isInvalidRefreshStatus(error.status)) {
        logout()
      }
      return null
    }
  }

  const refreshToken = async (): Promise<string | null> => {
    if (!token) return null

    try {
      const session = jwtDecode<Session>(token)
      const nowSec = Date.now() / 1000

      if (session.exp > nowSec) {
        return token
      }
    } catch {
      logout()
      return null
    }

    if (refreshTokenPromise) return await refreshTokenPromise

    refreshTokenPromise = performRefresh().finally(() => {
      refreshTokenPromise = null
    })

    return await refreshTokenPromise
  }

  return { login, logout, session, refreshToken, token }
})

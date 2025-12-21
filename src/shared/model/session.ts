import { useState } from 'react'
import { jwtDecode } from 'jwt-decode'
import { createGStore } from 'create-gstore'
import { publicFetchClient } from '../api/instance'

type Session = {
  userId: string
  email: string
  exp: number
  iat: number
}

type RefreshData = { accessToken?: string }

const TOKEN_KEY = 'token'

const isInvalidRefreshStatus = (status: number): boolean =>
  status === 401 || status === 403

let refreshTokenPromise: Promise<string | null> | null = null

const decodeSession = (token: string): Session | null => {
  try {
    return jwtDecode<Session>(token)
  } catch {
    return null
  }
}

export const useSession = createGStore(() => {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))

  const login = (token: string) => {
    localStorage.setItem(TOKEN_KEY, token)
    setToken(token)
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }

  const session = token ? decodeSession(token) : null

  const performRefresh = async (): Promise<string | null> => {
    try {
      const { data, error, response } = await publicFetchClient.POST('/auth/refresh')

      const status = response?.status ?? 0

      if (error || status >= 400) {
        if (isInvalidRefreshStatus(status)) {
          logout()
          return null
        }

        return null
      }

      const newToken = (data as RefreshData | undefined)?.accessToken ?? null

      if (newToken) {
        login(newToken)
        return newToken
      }

      logout()
      return null
    } catch (e) {
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

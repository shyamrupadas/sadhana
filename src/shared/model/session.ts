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

const TOKEN_KEY = 'token'

let refreshTokenPromise: Promise<string | null> | null = null

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

  const session = token ? jwtDecode<Session>(token) : null

  const refreshToken = async () => {
    if (!token) return null

    const session = jwtDecode<Session>(token)

    if (session.exp < Date.now() / 1000 + 1) {
      if (!refreshTokenPromise) {
        refreshTokenPromise = publicFetchClient
          .POST('/auth/refresh')
          .then(({ data }) => data?.accessToken ?? null)
          .then((newToken) => {
            if (newToken) {
              login(newToken)
              return newToken
            } else {
              logout()
              return null
            }
          })
          .finally(() => {
            refreshTokenPromise = null
          })
      }

      const newToken = await refreshTokenPromise

      if (newToken) {
        return newToken
      } else {
        return null
      }
    }
    return token
  }

  return { login, logout, session, refreshToken }
})

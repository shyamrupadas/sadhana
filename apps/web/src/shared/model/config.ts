type WebEnvironment = {
  MODE: string
  DEV: boolean
  VITE_API_BASE_URL?: string
  VITE_USE_MOCKS?: string
}

export function getWebConfiguration(env: WebEnvironment) {
  const isTest = env.MODE === 'test'
  const isDev = (env.DEV || env.MODE === 'development') && !isTest
  if (isTest) {
    if (env.VITE_API_BASE_URL !== '/test-api' || env.VITE_USE_MOCKS === 'true') {
      throw new Error('Тестовый web требует изолированный адрес /test-api без MSW.')
    }
  } else if (isDev) {
    if (
      env.VITE_API_BASE_URL !== 'http://localhost:8080' ||
      env.VITE_USE_MOCKS === 'true'
    ) {
      throw new Error(
        'Для dev задайте VITE_API_BASE_URL=http://localhost:8080 и VITE_USE_MOCKS=false.'
      )
    }
  }
  return {
    API_BASE_URL: env.VITE_API_BASE_URL,
    USE_MOCKS: env.VITE_USE_MOCKS === 'true',
    IS_DEV: isDev,
  } as const
}

export const CONFIG = getWebConfiguration(import.meta.env)

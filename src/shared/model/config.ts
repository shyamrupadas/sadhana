export const CONFIG = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  USE_MOCKS: import.meta.env.VITE_USE_MOCKS === 'true',
} as const

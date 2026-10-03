const RELOAD_KEY = 'app:chunk-reload'

const isChunkLoadError = (error: unknown) => {
  if (!(error instanceof Error)) return false

  return /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError/i.test(
    error.message,
  )
}

export const lazyWithRetry = <T>(factory: () => Promise<T>) => {
  return async () => {
    try {
      return await factory()
    } catch (error) {
      if (isChunkLoadError(error)) {
        const hasReloaded = sessionStorage.getItem(RELOAD_KEY)
        if (!hasReloaded) {
          sessionStorage.setItem(RELOAD_KEY, '1')
          window.location.reload()
        }
      }

      throw error
    }
  }
}

import { preparePwaUpdate } from './pwa-update'

const CHECK_INTERVAL = 10 * 60 * 1000
const ATTEMPT_KEY = 'app:update-attempt'

type UpdateAttempt = { fromVersion: string; targetVersion: string }

function readAttempt(): UpdateAttempt | null {
  const value = sessionStorage.getItem(ATTEMPT_KEY)
  if (!value) return null
  const attempt: UpdateAttempt = JSON.parse(value)
  if (
    typeof attempt.fromVersion !== 'string' ||
    typeof attempt.targetVersion !== 'string'
  ) {
    throw new Error('Некорректная запись перезапуска')
  }
  return attempt
}

export function createAppUpdater() {
  const version = import.meta.env.VITE_BUILD_ID
  let pending: Promise<void> | undefined
  let lastCheck = -Infinity
  let registration: Promise<ServiceWorkerRegistration> | undefined
  let controller: AbortController | undefined
  let stopped = true

  const register = () => {
    if (!('serviceWorker' in navigator)) return undefined
    registration ??= navigator.serviceWorker.register('/sw.js', {
      updateViaCache: 'none',
    })
    void registration.catch(() => {
      registration = undefined
    })
    return registration
  }

  const check = () => {
    if (pending) return pending
    lastCheck = Date.now()
    controller = new AbortController()
    const signal = controller.signal
    const timeout = setTimeout(() => controller?.abort(), 60_000)
    pending = (async () => {
      if (readAttempt()) return
      const response = await fetch('/release.json', { cache: 'no-store', signal })
      if (!response.ok) throw new Error('Не удалось проверить версию')
      const release: unknown = await response.json()
      if (
        !release ||
        typeof release !== 'object' ||
        !('version' in release) ||
        typeof release.version !== 'string' ||
        !release.version.trim()
      ) {
        throw new Error('Некорректная версия приложения')
      }
      if (release.version === version) return
      const worker = register()
      if (!worker) return
      await preparePwaUpdate(worker, release.version, signal)
      if (signal.aborted || stopped || readAttempt()) return
      const attempt: UpdateAttempt = {
        fromVersion: version,
        targetVersion: release.version,
      }
      sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt))
      // Do not navigate if durable protection could not be recorded.
      if (sessionStorage.getItem(ATTEMPT_KEY) !== JSON.stringify(attempt)) return
      location.reload()
    })()
      .catch(() => {
        // A background failure leaves the current application usable.
      })
      .finally(() => {
        clearTimeout(timeout)
        pending = undefined
      })
    return pending
  }

  return {
    confirmRecovery() {
      try {
        const attempt = readAttempt()
        if (!attempt || attempt.fromVersion === version) return false
        sessionStorage.removeItem(ATTEMPT_KEY)
        return true
      } catch {
        return false
      }
    },
    start() {
      stopped = false
      if ('serviceWorker' in navigator) {
        // Registration also installs the PWA on first visit, without a new release.
        register()
        navigator.serviceWorker.addEventListener('controllerchange', check)
      }
      // StrictMode may restart the effect while the aborted check is settling.
      if (pending)
        void pending.then(() => {
          if (!stopped) void check()
        })
      else void check()
      const timer = setInterval(() => {
        void check()
      }, CHECK_INTERVAL)
      const resume = () => {
        if (
          document.visibilityState === 'visible' &&
          Date.now() - lastCheck >= CHECK_INTERVAL
        ) {
          void check()
        }
      }
      document.addEventListener('visibilitychange', resume)
      return () => {
        stopped = true
        controller?.abort()
        clearInterval(timer)
        document.removeEventListener('visibilitychange', resume)
        navigator.serviceWorker?.removeEventListener('controllerchange', check)
      }
    },
  }
}

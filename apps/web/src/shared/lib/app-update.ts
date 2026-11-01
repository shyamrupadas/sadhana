import { preparePwaUpdate } from './pwa-update'

const CHECK_INTERVAL = 10 * 60 * 1000
const ATTEMPT_KEY = 'app:update-attempt'

type UpdateAttempt = { fromVersion: string }
type RecoveryState = 'working' | 'checking' | 'error'
export type AppUpdater = ReturnType<typeof createAppUpdater>

function readAttempt(): UpdateAttempt | null {
  const value = sessionStorage.getItem(ATTEMPT_KEY)
  if (!value) return null
  const attempt: UpdateAttempt = JSON.parse(value)
  if (!attempt || typeof attempt.fromVersion !== 'string') {
    throw new Error('Некорректная запись перезапуска')
  }
  return attempt
}

export function createAppUpdater() {
  const version = import.meta.env.VITE_BUILD_ID
  let pending: Promise<'current' | 'ready'> | undefined
  let lastCheck = -Infinity
  let registration: Promise<ServiceWorkerRegistration> | undefined
  let controller: AbortController | undefined
  let stopped = true
  let state: RecoveryState = 'working'
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined
  let recoveryId = 0
  const listeners = new Set<() => void>()
  const setState = (next: RecoveryState) => {
    state = next
    listeners.forEach((listener) => listener())
  }

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

  const cancelCheck = () => {
    controller?.abort()
    pending = undefined
  }

  const check = () => {
    if (pending) return pending
    lastCheck = Date.now()
    const checking = new AbortController()
    controller = checking
    const signal = checking.signal
    const timeout = setTimeout(() => checking.abort(), 60_000)
    const result = (async () => {
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
      signal.throwIfAborted()
      if (release.version === version) return 'current' as const
      const worker = register()
      if (!worker) throw new Error('Обновление PWA недоступно')
      await preparePwaUpdate(worker, release.version, signal)
      signal.throwIfAborted()
      return 'ready' as const
    })().finally(() => {
      clearTimeout(timeout)
      if (pending === result) pending = undefined
    })
    pending = result
    return result
  }

  const reload = (manual = false) => {
    const attempt: UpdateAttempt = { fromVersion: version }
    const value = JSON.stringify(attempt)
    try {
      sessionStorage.setItem(ATTEMPT_KEY, value)
      if (sessionStorage.getItem(ATTEMPT_KEY) !== value) {
        throw new Error('Не удалось сохранить защиту от цикла')
      }
    } catch (error) {
      // Explicit navigation remains available when storage is blocked.
      // Automatic navigation still requires durable protection.
      if (!manual) throw error
    }
    location.reload()
  }

  const backgroundCheck = async () => {
    if (stopped || state !== 'working' || document.visibilityState !== 'visible') return
    try {
      if (readAttempt()) return
      const result = await check()
      if (result === 'ready' && !stopped && state === 'working' && !readAttempt()) {
        reload()
      }
    } catch {
      // A background failure leaves the current application usable.
    }
  }

  const recover = (manual = false) => {
    if (state === 'checking' || (state === 'error' && !manual)) return
    const id = ++recoveryId
    const deadline = Date.now() + 15_000
    let finished = false
    const finish = (ready = false) => {
      if (id !== recoveryId || stopped || finished) return
      finished = true
      clearTimeout(recoveryTimer)
      cancelCheck()
      if (ready || manual) {
        try {
          reload(manual)
          return
        } catch {
          // Automatic navigation is unsafe without durable protection.
        }
      }
      setState('error')
    }
    try {
      if (!manual && readAttempt()) {
        setState('error')
        cancelCheck()
        return
      }
      setState('checking')
      recoveryTimer = setTimeout(() => finish(), 15_000)
      void check()
        .then((result) => {
          finish(result === 'ready' && Date.now() < deadline)
        })
        .catch(() => finish())
    } catch {
      if (manual) {
        finish()
        return
      }
      clearTimeout(recoveryTimer)
      setState('error')
      cancelCheck()
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => state,
    recover,
    confirmRecovery() {
      if (state !== 'working') return
      try {
        const attempt = readAttempt()
        if (!attempt || attempt.fromVersion === version) return
        sessionStorage.removeItem(ATTEMPT_KEY)
      } catch {
        // Keep protection when storage is unavailable.
      }
    },
    start(background = true) {
      stopped = false
      if (background) {
        register()
        navigator.serviceWorker?.addEventListener('controllerchange', backgroundCheck)
        void backgroundCheck()
      }
      const timer = background ? setInterval(backgroundCheck, CHECK_INTERVAL) : undefined
      const resume = () => {
        if (
          document.visibilityState === 'visible' &&
          Date.now() - lastCheck >= CHECK_INTERVAL
        ) {
          void backgroundCheck()
        }
      }
      if (background) document.addEventListener('visibilitychange', resume)
      return () => {
        stopped = true
        // StrictMode immediately reconnects the same updater. Keep its attempt
        // and deadline; a real unmount still cancels before any later reload.
        void Promise.resolve().then(() => {
          if (!stopped) return
          recoveryId++
          cancelCheck()
          clearTimeout(recoveryTimer)
        })
        clearInterval(timer)
        document.removeEventListener('visibilitychange', resume)
        navigator.serviceWorker?.removeEventListener('controllerchange', backgroundCheck)
      }
    },
  }
}

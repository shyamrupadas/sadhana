// Workbox precaches index.html and all build assets before activating a worker.
// Inspect the HTML served by that controller: activation alone says nothing about
// the version of JavaScript still running in this document.
export async function preparePwaUpdate(
  registering: Promise<ServiceWorkerRegistration>,
  version: string,
  signal: AbortSignal
): Promise<void> {
  const registration = await new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    void registering.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort)
    })
  })
  const container = navigator.serviceWorker
  return new Promise((resolve, reject) => {
    const workers = new Set<ServiceWorker>()
    let updating = true
    let checking = false
    let changed = false
    let settled = false

    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      container.removeEventListener('controllerchange', inspect)
      registration.removeEventListener('updatefound', inspect)
      signal.removeEventListener('abort', abort)
      workers.forEach((worker) => worker.removeEventListener('statechange', inspect))
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(signal.reason)
    const inspect = () => {
      if (settled) return
      for (const worker of [
        registration.installing,
        registration.waiting,
        registration.active,
      ]) {
        if (worker && !workers.has(worker)) {
          workers.add(worker)
          worker.addEventListener('statechange', inspect)
        }
      }
      registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
      if (checking) {
        changed = true
        return
      }
      if (registration.installing || registration.waiting) return
      const controller = container.controller
      if (
        !controller ||
        controller !== registration.active ||
        controller.state !== 'activated'
      )
        return
      checking = true
      changed = false
      void (async () => {
        const response = await fetch('/index.html', { cache: 'no-store', signal })
        if (!response.ok) throw new Error('Не удалось проверить подготовленную сборку')
        const html = new DOMParser().parseFromString(await response.text(), 'text/html')
        if (
          controller !== container.controller ||
          registration.installing ||
          registration.waiting
        ) {
          changed = true
          return
        }
        if (
          html.querySelector('meta[name="app-version"]')?.getAttribute('content') ===
          version
        ) {
          finish()
        } else if (!updating && !changed) {
          finish(new Error('Worker ещё не подготовил опубликованную сборку'))
        }
      })()
        .catch(finish)
        .finally(() => {
          checking = false
          if (changed) inspect()
        })
    }

    container.addEventListener('controllerchange', inspect)
    registration.addEventListener('updatefound', inspect)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }
    inspect()
    void registration.update().then(() => {
      updating = false
      inspect()
    }, finish)
  })
}

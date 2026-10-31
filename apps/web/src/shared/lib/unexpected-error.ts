import { ApiClientError } from '@sadhana/api-contract'

const ERROR_EVENT = 'app:unexpected-error'

export function reportUnexpectedError() {
  window.dispatchEvent(new Event(ERROR_EVENT))
}

export function subscribeUnexpectedErrors(listener: () => void) {
  window.addEventListener(ERROR_EVENT, listener)
  return () => window.removeEventListener(ERROR_EVENT, listener)
}

export function isUnexpectedApiError(error: unknown) {
  // Fetch failures and cancelled requests keep their existing offline/session flow.
  if (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === 'AbortError')
  )
    return false
  if (error instanceof ApiClientError) {
    const code =
      typeof error.body === 'object' && error.body && 'code' in error.body
        ? error.body.code
        : undefined
    if (
      ((error.status === 401 || error.status === 403) &&
        (code === 'UNAUTHORIZED' || code === 'NOT_AUTHORIZED')) ||
      (error.status === 400 && code === 'BAD_REQUEST') ||
      (error.status === 409 && code === 'CONFLICT') ||
      (error.status === 404 && code === 'NOT_FOUND') ||
      (error.status === 503 && code === 'TEMPORARILY_UNAVAILABLE')
    )
      return false
  }
  return true
}

export function reportApiError(error: unknown) {
  if (isUnexpectedApiError(error)) reportUnexpectedError()
}

import {
  Component,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
} from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useNavigation } from 'react-router'
import type { AppUpdater } from '@/shared/lib/app-update'
import { subscribeUnexpectedErrors } from '@/shared/lib/unexpected-error'
import { Button } from '@/shared/components/ui/button'

class InterfaceBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { broken: boolean }
> {
  state = { broken: false }
  static getDerivedStateFromError() {
    return { broken: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.broken ? null : this.props.children
  }
}

export function ApplicationUpdates({
  children,
  error,
  updater,
}: {
  children: ReactNode
  error?: unknown
  updater: AppUpdater
}) {
  const state = useSyncExternalStore(updater.subscribe, updater.getSnapshot)
  const queryClient = useQueryClient()
  const fetching = useIsFetching()
  const navigation = useNavigation()
  useLayoutEffect(() => {
    const stop = updater.start(!(import.meta.env.DEV && import.meta.env.MODE !== 'test'))
    const unsubscribe = subscribeUnexpectedErrors(() => updater.recover())
    const onError = (event: ErrorEvent) => {
      if (event.error) updater.recover()
    }
    const onRejection = () => updater.recover()
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      unsubscribe()
      stop()
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [updater])
  useEffect(() => {
    if (error !== undefined) updater.recover()
  }, [error, updater])
  useEffect(() => {
    const restored = queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.isActive())
      .every((query) => query.state.status === 'success')
    if (
      error === undefined &&
      state === 'working' &&
      navigation.state === 'idle' &&
      !fetching &&
      restored
    )
      updater.confirmRecovery()
  }, [error, state, navigation.state, fetching, queryClient, updater])

  if (state !== 'working')
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
        {state === 'checking' ? (
          <p role="status">Проверяем обновление…</p>
        ) : (
          <>
            <p role="alert">Что-то идёт не так, обновите страницу или попробуйте позже</p>
            <Button onClick={() => updater.recover(true)}>Обновить страницу</Button>
          </>
        )}
      </main>
    )
  return (
    <InterfaceBoundary onError={() => updater.recover()}>{children}</InterfaceBoundary>
  )
}

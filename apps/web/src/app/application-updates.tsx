import { useEffect, useState } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { createAppUpdater } from '@/shared/lib/app-update'

export function ApplicationUpdates() {
  const [updater] = useState(createAppUpdater)
  const [updated, setUpdated] = useState(false)
  const queryClient = useQueryClient()
  const fetching = useIsFetching()
  useEffect(() => {
    if (import.meta.env.DEV && import.meta.env.MODE !== 'test') return
    return updater.start()
  }, [updater])
  useEffect(() => {
    const restored = queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.isActive())
      .every((query) => query.state.status === 'success')
    if (!fetching && restored && updater.confirmRecovery()) setUpdated(true)
  }, [fetching, queryClient, updater])
  useEffect(() => {
    if (!updated) return
    const timeout = setTimeout(() => setUpdated(false), 5000)
    return () => clearTimeout(timeout)
  }, [updated])

  return updated ? (
    <div
      role="status"
      className="fixed inset-x-4 bottom-20 z-50 mx-auto w-fit rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"
    >
      Приложение обновлено
    </div>
  ) : null
}

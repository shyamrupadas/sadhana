import { type RouteObject, useRouteError } from 'react-router'
import { createAppUpdater } from '@/shared/lib/app-update'
import { App } from './app'

export function createApplicationRoute(children: RouteObject[]): RouteObject {
  // One coordinator per router/document, including replacement by its error boundary.
  const updater = createAppUpdater()
  return {
    Component: () => <App updater={updater} />,
    ErrorBoundary: () => <App updater={updater} error={useRouteError()} />,
    children,
  }
}

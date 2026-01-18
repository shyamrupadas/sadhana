import { lazyWithRetry } from '@/shared/lib/lazy-with-retry'
import { ROUTES } from '@/shared/model/routes'
import { createBrowserRouter } from 'react-router'

import { App } from './app'
import { ProtectedRoute } from './protected-route'
import { protectedLoader } from './protected-loader'

export const router = createBrowserRouter([
  {
    Component: App,
    children: [
      {
        loader: protectedLoader,
        Component: ProtectedRoute,
        children: [
          {
            path: ROUTES.HOME,
            lazy: lazyWithRetry(() => import('@/features/main/main.page')),
          },
        ],
      },
      {
        path: ROUTES.LOGIN,
        lazy: lazyWithRetry(() => import('@/features/auth/login.page')),
      },
      {
        path: ROUTES.REGISTER,
        lazy: lazyWithRetry(() => import('@/features/auth/register.page')),
      },
    ],
  },
])

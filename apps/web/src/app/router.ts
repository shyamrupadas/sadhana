import { ROUTES } from '@/shared/model/routes'
import { createBrowserRouter } from 'react-router'

import { createApplicationRoute } from './application-route'
import { ProtectedRoute } from './protected-route'
import { protectedLoader } from './protected-loader'

export const router = createBrowserRouter([
  createApplicationRoute([
    {
      loader: protectedLoader,
      Component: ProtectedRoute,
      children: [
        {
          path: ROUTES.HOME,
          lazy: () => import('@/features/main/main.page'),
        },
        {
          path: ROUTES.STATISTICS,
          lazy: () => import('@/features/statistics/statistics.page'),
        },
        {
          path: ROUTES.SETTINGS,
          lazy: () => import('@/features/settings/settings.page'),
        },
      ],
    },
    {
      path: ROUTES.LOGIN,
      lazy: () => import('@/features/auth/login.page'),
    },
    {
      path: ROUTES.REGISTER,
      lazy: () => import('@/features/auth/register.page'),
    },
  ]),
])

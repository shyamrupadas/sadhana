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
          { path: ROUTES.HOME, lazy: () => import('@/features/main/main.page') },
        ],
      },
      { path: ROUTES.LOGIN, lazy: () => import('@/features/auth/login.page') },
      { path: ROUTES.REGISTER, lazy: () => import('@/features/auth/register.page') },
    ],
  },
])

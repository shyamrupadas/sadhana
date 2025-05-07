import { ROUTES } from '@/shared/model/routes'
import { createBrowserRouter } from 'react-router'

import { App } from './app'

export const router = createBrowserRouter([
  {
    Component: App,
    children: [
      { path: ROUTES.HOME, lazy: () => import('@/features/main/main.page') },
      { path: ROUTES.LOGIN, lazy: () => import('@/features/auth/login.page') },
      { path: ROUTES.REGISTER, lazy: () => import('@/features/auth/register.page') },
    ],
  },
])

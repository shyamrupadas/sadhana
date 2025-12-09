import { redirect } from 'react-router'

import { ROUTES } from '@/shared/model/routes'
import { useSession } from '@/shared/model/session'
import { enableMocking } from '@/shared/api/mocks'

export const protectedLoader = async () => {
  await enableMocking()

  const token = await useSession.getState().refreshToken()
  if (!token) {
    return redirect(ROUTES.LOGIN)
  }

  return null
}

import { redirect } from 'react-router'

import { ROUTES } from '@/shared/model/routes'
import { useSession } from '@/shared/model/session'
import { enableMocking } from '@/shared/api/mocks'

export const protectedLoader = async () => {
  await enableMocking()

  const session = useSession.getState()
  const token = await session.refreshToken()

  if (!token) {
    if (!session.token) {
      return redirect(ROUTES.LOGIN)
    }

    return null
  }

  return null
}

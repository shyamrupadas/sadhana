import { useNavigate } from 'react-router'

import { rqClient } from '@/shared/api/instance'
import { ApiShemas } from '@/shared/api/schema'
import { ROUTES } from '@/shared/model/routes'
import { useSession } from '@/shared/model/session'

export const useRegister = () => {
  const navigate = useNavigate()

  const session = useSession()

  const registerMutation = rqClient.useMutation('post', '/auth/register', {
    onSuccess: (data) => {
      session.login(data.accessToken)
      navigate(ROUTES.HOME)
    },
  })

  const register = (data: ApiShemas['RegisterRequest']) => {
    registerMutation.mutate({ body: data })
  }

  const errorMessage = registerMutation.isError
    ? registerMutation.error.message
    : undefined

  return {
    register,
    isPending: registerMutation.isPending,
    errorMessage,
  }
}

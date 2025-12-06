import { useNavigate } from 'react-router'

import { rqClient } from '@/shared/api/instance'
import { ApiShemas } from '@/shared/api/schema'
import { ROUTES } from '@/shared/model/routes'

export const useRegister = () => {
  const navigate = useNavigate()

  const registerMutation = rqClient.useMutation('post', '/auth/register', {
    onSuccess: () => {
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

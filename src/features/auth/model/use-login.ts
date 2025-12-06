import { useNavigate } from 'react-router'

import { rqClient } from '@/shared/api/instance'
import { ApiShemas } from '@/shared/api/schema'
import { ROUTES } from '@/shared/model/routes'

export const useLogin = () => {
  const navigate = useNavigate()

  const loginMutation = rqClient.useMutation('post', '/auth/login', {
    onSuccess: () => {
      navigate(ROUTES.HOME)
    },
  })

  const login = (data: ApiShemas['LoginRequest']) => {
    loginMutation.mutate({ body: data })
  }

  const errorMessage = loginMutation.isError ? loginMutation.error.message : undefined

  return {
    login,
    isPending: loginMutation.isPending,
    errorMessage,
  }
}

import { useNavigate } from 'react-router'

import { publicRqClient } from '@/shared/api/instance'
import { ApiShemas } from '@/shared/api/schema'
import { ROUTES } from '@/shared/model/routes'
import { useSession } from '@/shared/model/session'

export const useLogin = () => {
  const navigate = useNavigate()

  const session = useSession()

  const loginMutation = publicRqClient.useMutation('post', '/auth/login', {
    onSuccess: (data) => {
      session.login(data.accessToken)
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

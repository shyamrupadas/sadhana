import { useNavigate } from 'react-router'
import { useMutation } from '@tanstack/react-query'

import { publicApiClient } from '@/shared/api/instance'
import { ROUTES } from '@/shared/model/routes'
import { useSession } from '@/shared/model/session'

export const useLogin = () => {
  const navigate = useNavigate()

  const session = useSession()

  const loginMutation = useMutation({
    mutationFn: (data: Parameters<typeof publicApiClient.login>[0]) => publicApiClient.login(data),
    onSuccess: (data) => {
      session.login(data.accessToken)
      navigate(ROUTES.HOME)
    },
  })

  const login = (data: Parameters<typeof publicApiClient.login>[0]) => {
    loginMutation.mutate(data)
  }

  const errorMessage = loginMutation.isError ? loginMutation.error.message : undefined

  return {
    login,
    isPending: loginMutation.isPending,
    errorMessage,
  }
}

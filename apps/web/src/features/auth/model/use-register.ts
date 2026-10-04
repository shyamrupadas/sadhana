import { useNavigate } from 'react-router'
import { useMutation } from '@tanstack/react-query'

import { publicApiClient } from '@/shared/api/instance'
import { ROUTES } from '@/shared/model/routes'
import { useSession } from '@/shared/model/session'

export const useRegister = () => {
  const navigate = useNavigate()

  const session = useSession()

  const registerMutation = useMutation({
    mutationFn: (data: Parameters<typeof publicApiClient.register>[0]) => publicApiClient.register(data),
    onSuccess: (data) => {
      session.login(data.accessToken)
      navigate(ROUTES.HOME)
    },
  })

  const register = (data: Parameters<typeof publicApiClient.register>[0]) => {
    registerMutation.mutate(data)
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

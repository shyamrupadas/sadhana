import { CONFIG } from '@/shared/model/config'

export const enableMocking = async () => {
  if (import.meta.env.PROD || !CONFIG.USE_MOCKS) {
    return
  }

  const { worker } = await import('@/shared/api/mocks/browser')
  return worker.start()
}

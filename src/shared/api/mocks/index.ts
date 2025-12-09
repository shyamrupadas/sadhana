export const enableMocking = async () => {
  if (import.meta.env.PROD) {
    return
  }

  const { worker } = await import('@/shared/api/mocks/browser')
  return worker.start()
}

import { ROUTES } from '@/shared/model/routes'
import { useSession } from '@/shared/model/session'
import { Navigate, Outlet } from 'react-router'
import { BottomNavigation } from './bottom-navigation'

export const ProtectedRoute = () => {
  const { session } = useSession()

  if (!session) {
    return <Navigate to={ROUTES.LOGIN} replace />
  }
  return (
    <div className="flex grow flex-col pb-[calc(4rem+env(safe-area-inset-bottom))]">
      <Outlet />
      <BottomNavigation />
    </div>
  )
}

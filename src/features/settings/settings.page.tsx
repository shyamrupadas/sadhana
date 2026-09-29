import { useNavigate } from 'react-router'

import { Button } from '@/shared/components/ui/button'
import { ROUTES } from '@/shared/model/routes'
import { useSession } from '@/shared/model/session'

const SettingsPage = () => {
  const { logout, session } = useSession()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate(ROUTES.LOGIN, { replace: true })
  }

  return (
    <main className="flex grow justify-center motion-safe:animate-[fade-in_500ms_ease-in-out]">
      <div className="w-full max-w-100 space-y-6 p-4">
        <h1 className="text-xl font-medium">Ещё</h1>
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Электронная почта</p>
          <p className="break-all">{session?.email}</p>
        </div>
        <Button variant="outline" onClick={handleLogout}>
          Выйти
        </Button>
      </div>
    </main>
  )
}

export const Component = SettingsPage

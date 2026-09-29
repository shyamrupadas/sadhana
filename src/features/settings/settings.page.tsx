import { useNavigate } from 'react-router'
import { LogOut } from 'lucide-react'

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
    <main className="flex grow justify-center bg-slate-50 motion-safe:animate-[fade-in_500ms_ease-in-out]">
      <div className="w-full max-w-100 p-4">
        <div className="mb-4 flex h-9 items-center">
          <h1 className="text-xl font-medium text-slate-700">Настройки</h1>
        </div>
        <section className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-700">Учётная запись</h2>
            <p className="mt-1 break-all text-xs text-slate-500">{session?.email}</p>
          </div>
          <Button
            className="h-9 bg-red-50 px-3 text-xs text-red-700 shadow-none hover:bg-red-100"
            onClick={handleLogout}
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            Выйти
          </Button>
        </section>
      </div>
    </main>
  )
}

export const Component = SettingsPage

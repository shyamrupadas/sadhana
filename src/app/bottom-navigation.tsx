import { Home, Menu } from 'lucide-react'
import { NavLink } from 'react-router'

import { ROUTES } from '@/shared/model/routes'
import { cn } from '@/shared/lib/utils'

const items = [
  { to: ROUTES.HOME, label: 'Главная', icon: Home },
  { to: ROUTES.SETTINGS, label: 'Ещё', icon: Menu },
]

export const BottomNavigation = () => (
  <nav
    aria-label="Основная навигация"
    className="fixed inset-x-0 bottom-0 z-50 border-t bg-background pb-[env(safe-area-inset-bottom)]"
  >
    <div className="mx-auto flex h-16 w-full max-w-100">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground',
              isActive && 'font-medium text-foreground'
            )
          }
        >
          <Icon className="size-5" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </div>
  </nav>
)

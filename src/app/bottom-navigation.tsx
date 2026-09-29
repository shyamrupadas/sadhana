import { NavLink } from 'react-router'

import { ROUTES } from '@/shared/model/routes'
import { cn } from '@/shared/lib/utils'

const items = [
  {
    to: ROUTES.HOME,
    label: 'Главная',
    icon: 'M12 2.75c-.62 0-1.21.22-1.68.62l-5.8 4.93a4.1 4.1 0 0 0-1.42 3.12v5.55A2.03 2.03 0 0 0 5.13 19h3.28c.43 0 .79-.35.79-.79v-3.55c0-.86.7-1.56 1.56-1.56h2.48c.86 0 1.56.7 1.56 1.56v3.55c0 .44.35.79.79.79h3.28a2.03 2.03 0 0 0 2.03-2.03v-5.55c0-1.2-.52-2.34-1.43-3.12l-5.79-4.93A2.58 2.58 0 0 0 12 2.75Zm-1.75 16.25v-4.28c0-.45.37-.82.82-.82h1.86c.45 0 .82.37.82.82V19Z',
  },
  {
    to: ROUTES.STATISTICS,
    label: 'Статистика',
    icon: 'M4.5 19.5V13m5 6.5V8m5 11.5v-9m5 9V4.5',
  },
  {
    to: ROUTES.SETTINGS,
    label: 'Ещё',
    icon: 'M6.1 4.35h2.55c.96 0 1.75.79 1.75 1.75v2.55c0 .96-.79 1.75-1.75 1.75H6.1c-.96 0-1.75-.79-1.75-1.75V6.1c0-.96.79-1.75 1.75-1.75Zm9.25 0h2.55c.96 0 1.75.79 1.75 1.75v2.55c0 .96-.79 1.75-1.75 1.75h-2.55c-.96 0-1.75-.79-1.75-1.75V6.1c0-.96.79-1.75 1.75-1.75ZM6.1 13.6h2.55c.96 0 1.75.79 1.75 1.75v2.55c0 .96-.79 1.75-1.75 1.75H6.1c-.96 0-1.75-.79-1.75-1.75v-2.55c0-.96.79-1.75 1.75-1.75Zm9.25 0h2.55c.96 0 1.75.79 1.75 1.75v2.55c0 .96-.79 1.75-1.75 1.75h-2.55c-.96 0-1.75-.79-1.75-1.75v-2.55c0-.96.79-1.75 1.75-1.75Z',
  },
]

export const BottomNavigation = () => (
  <nav
    aria-label="Основная навигация"
    className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_0_#0f172a14]"
  >
    <div className="flex h-16 w-full justify-between">
      {items.map(({ to, label, icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            cn(
              'flex w-1/4 min-w-0 flex-col items-center justify-center gap-0.5 text-xs font-medium text-slate-500 hover:text-slate-700',
              isActive && 'font-semibold text-blue-600 hover:text-blue-600'
            )
          }
        >
          <svg
            className="size-5.5 shrink-0 fill-current"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d={icon}
              fillRule={to === ROUTES.HOME ? 'evenodd' : undefined}
              fill={to === ROUTES.STATISTICS ? 'none' : undefined}
              stroke={to === ROUTES.STATISTICS ? 'currentColor' : undefined}
              strokeWidth={to === ROUTES.STATISTICS ? 2 : undefined}
              strokeLinecap={to === ROUTES.STATISTICS ? 'round' : undefined}
            />
          </svg>
          <span className="max-w-full truncate">{label}</span>
        </NavLink>
      ))}
    </div>
  </nav>
)

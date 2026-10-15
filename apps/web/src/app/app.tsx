import { Outlet } from 'react-router'
import { Providers } from './providers'
import { CONFIG } from '@/shared/model/config'

export const App = () => {
  return (
    <Providers>
      <div className="min-h-[100svh] min-h-[100dvh] flex flex-col">
        {CONFIG.IS_DEV && (
          <div
            role="status"
            className="pointer-events-none fixed top-2 right-2 z-50 w-fit rounded bg-amber-200 px-2 py-1 text-center text-xs font-semibold text-amber-950"
          >
            DEV
          </div>
        )}
        <Outlet />
      </div>
    </Providers>
  )
}

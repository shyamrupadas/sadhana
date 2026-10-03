import { Outlet } from 'react-router'
import { Providers } from './providers'

export const App = () => {
  return (
    <Providers>
      <div className="min-h-[100svh] min-h-[100dvh] flex flex-col">
        <Outlet />
      </div>
    </Providers>
  )
}

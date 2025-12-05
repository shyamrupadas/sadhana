import { Outlet } from 'react-router'
import { Providers } from './providers'

export const App = () => {
  return (
    <Providers>
      <div className="min-h-screen flex flex-col">
        <Outlet />
      </div>
    </Providers>
  )
}

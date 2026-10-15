import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import './index.css'

const root = createRoot(document.getElementById('root')!)

// Validate configuration before constructing the router (its loaders can issue API requests).
async function start() {
  const { enableMocking } = await import('@/shared/api/mocks')
  await enableMocking()
  const { router } = await import('./router')
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  )
}

start().catch(() => {
  root.render(
    <div role="alert" className="p-6">
      Ошибка конфигурации web. Для dev задайте VITE_API_BASE_URL=http://localhost:8080 и
      VITE_USE_MOCKS=false.
    </div>
  )
})

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/test-api'),
  },
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  test: {
    css: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/shared/test/setup.ts'],
  },
})

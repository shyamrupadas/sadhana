import path from 'path'
import { randomUUID } from 'node:crypto'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
const version = process.env.VITE_BUILD_ID || randomUUID()

export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(version),
  },
  optimizeDeps: {
    exclude: ['@sadhana/api-contract'],
  },
  plugins: [
    {
      name: 'release-artifact',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'release.json',
          source: JSON.stringify({ version }),
        })
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globIgnores: ['**/release.json'],
        navigateFallbackDenylist: [/^\/release\.json$/],
      },
      manifest: {
        name: 'SadhanaTracker',
        short_name: 'Sadhana',
        start_url: '/',
        description: 'Трекер сна и привычек',
        display: 'standalone',
        theme_color: '#ffffff',
        icons: [
          {
            src: '/check-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/check-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: {
    host: true,
    https: {},
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})

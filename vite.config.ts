import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
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

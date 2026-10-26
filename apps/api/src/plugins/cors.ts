import fp from 'fastify-plugin'
import cors, { FastifyCorsOptions } from '@fastify/cors'

const allowedOrigins = new Set<string>([
  'http://localhost:5173',
  'https://app.sadhana-tracker.com',
])

export default fp<FastifyCorsOptions>(async (fastify) => {
  fastify.register(cors, {
    origin: (origin, cb) => {
      // server-to-server / curl / healthcheck
      if (!origin) {
        cb(null, true)
        return
      }

      const isConfiguredDevOrigin =
        fastify.config.DB_ENVIRONMENT === 'dev' &&
        origin === fastify.config.CORS_ORIGIN

      if (allowedOrigins.has(origin) || isConfiguredDevOrigin) {
        cb(null, true)
        return
      }

      cb(new Error(`CORS blocked for origin: ${origin}`), false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
})

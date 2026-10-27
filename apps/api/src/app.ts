import { join } from 'node:path'
import AutoLoad, { AutoloadPluginOptions } from '@fastify/autoload'
import { FastifyPluginAsync, FastifyServerOptions } from 'fastify'
import { createApiHandlers } from './api-handlers'
import envPlugin from './plugins/env'
import type { DatabaseEnvironment } from './config/environment'
import { verifyApplicationSchema } from './db/application-schema'

export interface AppOptions extends FastifyServerOptions, Partial<AutoloadPluginOptions> {
  dbEnvironment?: DatabaseEnvironment
  verifySchema?: boolean
}
// Pass --options via CLI arguments in command to enable these options.
const options: AppOptions = {
  trustProxy: true, // Railway/NGINX/Cloudflare: нужен для корректного protocol/ip и x-forwarded-*
}

const app: FastifyPluginAsync<AppOptions> = async (fastify, opts): Promise<void> => {
  await fastify.register(envPlugin, { dbEnvironment: opts.dbEnvironment })

  if (opts.verifySchema) {
    fastify.addHook('onReady', () => verifyApplicationSchema(fastify.pg.pool))
  }

  // Do not touch the following lines

  // This loads all plugins defined in plugins
  // those should be support plugins that are reused
  // through your application
  void fastify.register(AutoLoad, {
    dir: join(__dirname, 'plugins'),
    ignorePattern: /^env\.(?:ts|js)$/,
    options: opts,
  })

  fastify.decorate('apiHandlers', createApiHandlers(fastify))

  // This loads all plugins defined in routes
  // define your routes in one of these
  void fastify.register(AutoLoad, {
    dir: join(__dirname, 'routes'),
    options: opts,
  })
}

export default app
export { app, options }

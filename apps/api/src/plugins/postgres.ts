import { FastifyPluginAsync } from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import fastifyPostgres from '@fastify/postgres'

const postgresPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyPostgres, {
    connectionString: fastify.config.DATABASE_URL,
  })

  fastify.pg.pool.on('error', () => fastify.log.error('Database connection failed'))
}

export default fastifyPlugin(postgresPlugin, { dependencies: ['env'] })

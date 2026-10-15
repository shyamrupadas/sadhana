import { FastifyPluginAsync } from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { loadConfiguration, type DatabaseEnvironment } from '../config/environment'

const envPlugin: FastifyPluginAsync<{ dbEnvironment?: DatabaseEnvironment }> = async (
  fastify,
  options
) => {
  const config = loadConfiguration({ context: options.dbEnvironment })
  fastify.decorate('config', config)
  fastify.log.info(config.databaseIdentity, 'Database target validated')
}

export default fastifyPlugin(envPlugin, { name: 'env' })

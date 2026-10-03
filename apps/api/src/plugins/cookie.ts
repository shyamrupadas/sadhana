import { FastifyPluginAsync } from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import fastifyCookie from '@fastify/cookie'

const cookiePlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyCookie, {
    parseOptions: {},
  })
}

export default fastifyPlugin(cookiePlugin)

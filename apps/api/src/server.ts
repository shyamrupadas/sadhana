import Fastify from 'fastify'
import app from './app'

const server = Fastify({
  logger: true,
})

server.register(app)

const start = async () => {
  try {
    const port = Number(process.env.PORT || 8080)
    const host = '0.0.0.0'

    await server.listen({ port, host })
    server.log.info(`Server listening on ${host}:${port}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()

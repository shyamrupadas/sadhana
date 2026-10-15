import Fastify from 'fastify'
import app from './app'
import { ConfigurationError, type DatabaseEnvironment } from './config/environment'

export async function startServer(context?: DatabaseEnvironment) {
  const server = Fastify({
    logger: {
      // Driver and SQL errors may carry credentials or user data in message/detail/stack.
      serializers: {
        err: () => ({ type: 'Error', message: 'Operation failed', stack: '' }),
        req: (request) => ({ method: request.method }),
        res: (reply) => ({ statusCode: reply.statusCode }),
      },
    },
  })
  server.register(app, { dbEnvironment: context })
  try {
    const port = Number(process.env.PORT || 8080)
    await server.listen({ port, host: '0.0.0.0' })
  } catch (error) {
    server.log.error(
      error instanceof ConfigurationError
        ? error.message
        : 'API startup failed; verify environment, database target and required secrets'
    )
    await server.close()
    process.exitCode = 1
  }
}

if (require.main === module) void startServer()

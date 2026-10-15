// This file contains code that we reuse between our tests.
import * as path from 'node:path'
import * as test from 'node:test'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const helper = require('fastify-cli/helper.js')

export type TestContext = {
  after: typeof test.after
}

const AppPath = path.join(__dirname, '..', 'src', 'app.ts')

// Fill in this config with all the configurations
// needed for testing the application
function config() {
  return {
    skipOverride: true, // Register our application with fastify-plugin
  }
}

// Automatically build and tear down our instance
async function build(t: TestContext) {
  // you can set all the options supported by the fastify CLI command
  const previousEnvironment = { ...process.env }
  t.after(() => {
    process.env = previousEnvironment
  })
  Object.assign(process.env, {
    DB_ENVIRONMENT: 'test',
    DATABASE_URL: 'postgres://fixture:fixture@db.invalid/app',
    MIGRATION_DATABASE_URL: 'postgres://fixture:fixture@db.invalid/app',
    JWT_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
  })
  const argv = [AppPath]

  // fastify-plugin ensures that all decorators
  // are exposed for testing purposes, this is
  // different from the production setup
  const app = await helper.build(argv, config())

  // Tear down our app after we are done
  t.after(() => void app.close())

  return app
}

export { config, build }

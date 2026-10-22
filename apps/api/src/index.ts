import './instrument.js'
import { serve } from '@hono/node-server'
import { app } from './app.js'
import { type Config, ConfigError, loadConfig } from './platform/config.js'
import { closeDatabase } from './platform/db.js'
import { log } from './platform/log.js'

let config: Config
try {
  config = loadConfig()
} catch (error) {
  if (error instanceof ConfigError) {
    log.fatal({ variables: error.variables }, error.message)
    process.exit(1)
  }
  throw error
}

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: '0.0.0.0' }, (info) => {
  log.info({ port: info.port, env: config.APP_ENV }, 'api listening')
})

/** Clean stop on deploy: stop accepting, finish in flight requests, close the pools. */
function shutdown(signal: NodeJS.Signals) {
  log.info({ signal }, 'shutting down')
  server.close(() => {
    void closeDatabase().finally(() => process.exit(0))
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

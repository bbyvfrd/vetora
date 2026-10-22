import { parseArgs } from 'node:util'
import { ConfigError, loadMigratorConfig } from './platform/config.js'
import { migrateLog as log, type MigrateOutcome, migrate } from './platform/db/migrator.js'
import { scrubError } from './platform/log.js'

/**
 * `migrate`: brings the database up to the committed migration sets as vetora_migrator (spec 0001 "Migrations",
 * spec 0002 "Interface surface"). Locally `pnpm --filter @vetora/api migrate [--dry-run]`; on a server
 * `node apps/api/dist/migrate.js` through `kamal app exec` before traffic switches. A thin entry point over
 * src/platform/db/migrator.ts, as openapi.ts is over app.ts.
 *
 * Exit codes: 0 the database is current (nothing to do and a dry run included), 1 the run did not complete (a
 * migration failed and its batch was rolled back, or the connection or configuration failed), 2 another run holds
 * the migrate lock.
 */
function exitCode(outcome: MigrateOutcome): number {
  switch (outcome.status) {
    case 'applied':
    case 'dry-run':
      return 0
    case 'lock-held':
      return 2
    case 'failed':
      return 1
  }
}

async function main(): Promise<number> {
  let dryRun: boolean
  try {
    dryRun = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } }, strict: true }).values['dry-run']
  } catch (error) {
    log.fatal({ err: error }, 'usage: migrate [--dry-run]')
    return 1
  }

  let url: string
  try {
    url = loadMigratorConfig().DATABASE_URL_MIGRATOR
  } catch (error) {
    if (error instanceof ConfigError) {
      log.fatal({ variables: error.variables }, error.message)
      return 1
    }
    throw error
  }

  try {
    return exitCode(await migrate({ url, dryRun, log }))
  } catch (error) {
    log.fatal({ err: scrubError(error) }, 'migrate did not complete')
    return 1
  }
}

process.exitCode = await main()

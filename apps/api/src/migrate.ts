import { parseArgs } from 'node:util'
import { ConfigError, loadMigratorConfig } from './platform/config.js'
import { migrateLog as log, type MigrateOutcome, migrate } from './platform/db/migrator.js'
import { scrubError } from './platform/log.js'

/**
 * `migrate`: brings the database up to the committed migration sets as vetora_migrator (spec 0001 "Migrations",
 * spec 0002 "Interface surface"): the control set, then the practice set in every registered practice schema (or
 * the one `--practice <slug>` names) with the grants step after each. Locally
 * `pnpm --filter @vetora/api migrate [--dry-run] [--practice <slug>]`; on a server `node apps/api/dist/migrate.js`
 * through `kamal app exec` before traffic switches. A thin entry point over src/platform/db/migrator.ts, as
 * openapi.ts is over app.ts.
 *
 * Exit codes: 0 every schema is current (nothing to do and a dry run included), 1 the run did not complete (a
 * schema's migrations or grants failed and the loop stopped there, the slug is not registered, or the connection or
 * configuration failed), 2 another run holds the migrate lock.
 */
function exitCode(outcome: MigrateOutcome): number {
  switch (outcome.status) {
    case 'applied':
    case 'dry-run':
      return 0
    case 'lock-held':
      return 2
    case 'failed':
    case 'not-registered':
      return 1
  }
}

async function main(): Promise<number> {
  let dryRun: boolean
  let practice: string | undefined
  try {
    // `pnpm migrate -- --dry-run` hands the `--` on to node, which passes it to the script: drop it.
    const args = process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2)
    const { values } = parseArgs({
      args,
      options: { 'dry-run': { type: 'boolean', default: false }, practice: { type: 'string' } },
      strict: true,
    })
    dryRun = values['dry-run']
    practice = values.practice
  } catch (error) {
    log.fatal({ err: error }, 'usage: migrate [--dry-run] [--practice <slug>]')
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
    return exitCode(await migrate({ url, dryRun, practice, log }))
  } catch (error) {
    log.fatal({ err: scrubError(error) }, 'migrate did not complete')
    return 1
  }
}

process.exitCode = await main()

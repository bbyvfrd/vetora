import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { loadInput, loadServices, servicesFile } from './modules/inventory/index.js'
import { ConfigError, loadMigratorConfig } from './platform/config.js'
import { log as baseLog, scrubError } from './platform/log.js'

/**
 * `load-services`: loads a practice's price list from a file (spec #18, "Commands"; story 18; #25), until feature 15's
 * screen. Locally `pnpm --filter @vetora/api load-services -- --practice alfa --file services.json`; on a server
 * `node apps/api/dist/load-services.js …` through `kamal app exec`. The file is a JSON array, one object per service:
 *
 *   [{ "names": { "az": "Müayinə", "ru": "Осмотр", "en": "Consultation" },
 *      "category": "consultation", "priceMinor": 2500, "currency": "AZN" }]
 *
 * the price in minor units (2500 qəpik is 25,00 ₼; IN-4), the category one of consultation, procedure, lab, grooming,
 * boarding, other. Each entry is matched to a service by its name in any language, so a rerun updates prices and adds
 * new services without doubling any (the inventory module's loadServices()). Writes as the migrator, audited as
 * `migration:load-services`.
 *
 * Exit codes: 0 every entry is on the list, 1 an argument or the file is invalid, the practice is unknown, an entry is
 * ambiguous, or the run did not complete (and nothing was written).
 */
const usage = 'usage: load-services --practice <code> --file <services.json>'

const log = baseLog.child({ command: 'load-services' })

async function main(): Promise<number> {
  let values: { practice?: string; file?: string }
  try {
    const args = process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2)
    values = parseArgs({
      args,
      options: { practice: { type: 'string' }, file: { type: 'string' } },
      strict: true,
    }).values
  } catch (error) {
    // The parser's message quotes the stray token: log its code only.
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown'
    log.fatal({ code }, usage)
    return 1
  }

  const input = loadInput.safeParse({ practiceCode: values.practice })
  if (!input.success || !values.file) {
    const invalid = input.success
      ? []
      : input.error.issues.map((issue) => ({ option: '--practice', problem: issue.message }))
    if (!values.file) invalid.push({ option: '--file', problem: 'the path of the services file' })
    log.fatal({ invalid }, usage)
    return 1
  }

  let text: string
  try {
    text = await readFile(values.file, 'utf8')
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown'
    log.fatal({ code }, 'the services file could not be read')
    return 1
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    log.fatal('the services file is not JSON')
    return 1
  }
  const services = servicesFile.safeParse(json)
  if (!services.success) {
    // Where each problem is (the entry and its field) and what it is; never the value.
    const invalid = services.error.issues.map((issue) => ({ path: issue.path.join('.'), problem: issue.message }))
    log.fatal({ invalid }, 'the services file is not a list of services')
    return 1
  }

  let migratorUrl: string
  try {
    migratorUrl = loadMigratorConfig().DATABASE_URL_MIGRATOR
  } catch (error) {
    if (error instanceof ConfigError) {
      log.fatal({ variables: error.variables }, error.message)
      return 1
    }
    throw error
  }

  try {
    const outcome = await loadServices({ migratorUrl, practiceCode: input.data.practiceCode, services: services.data })
    switch (outcome.status) {
      case 'loaded':
        log.info({ added: outcome.added, updated: outcome.updated, unchanged: outcome.unchanged }, 'services loaded')
        return 0
      case 'no-practice':
        log.fatal('no active practice has this code; nothing was written')
        return 1
      case 'ambiguous':
        log.fatal(
          { entry: outcome.entry },
          'this entry shares a name with an earlier one or with two services on the list; nothing was written',
        )
        return 1
    }
  } catch (error) {
    log.fatal({ err: scrubError(error) }, 'load-services did not complete')
    return 1
  }
}

process.exitCode = await main()

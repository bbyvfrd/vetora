import { parseArgs } from 'node:util'
import { ConfigError, loadConfig, loadMigratorConfig } from './platform/config.js'
import { closeDatabase } from './platform/db/index.js'
import {
  provisionLog as log,
  type ProvisionOutcome,
  provisionInput,
  provisionPractice,
} from './platform/db/provisioning.js'
import { scrubError } from './platform/log.js'
import { readPassword } from './platform/prompt.js'

/**
 * `provision-practice`: creates a practice behind its own role with its first manager's login and its organization
 * (spec 0001 "Provisioning", spec 0002 "Interface surface", spec #18 "Commands") as vetora_migrator under the migrate
 * lock, every step idempotent, so a rerun completes what an earlier run left undone and changes nothing else. Prints
 * the practice id. Locally `pnpm --filter @vetora/api provision-practice -- --slug alfa --name "Alfa Vet"
 * --manager-handle dr.aliyeva --manager-name "Dr Aliyeva" --location-name "Nərimanov" [--time-zone Asia/Baku]
 * [--languages az,ru]`; on a server `node apps/api/dist/provision-practice.js …` through `kamal app exec`. The
 * manager's password is asked at a hidden prompt, or read from standard input when it is not a terminal, and only when
 * their login is created (src/platform/prompt.ts). A thin entry point over src/platform/db/provisioning.ts, as
 * migrate.ts is over the migrator.
 *
 * Exit codes: 0 the practice is provisioned (a rerun included), 1 the slug belongs to a practice with another name,
 * an argument or the password is invalid, or the run did not complete (a step failed, or the connection or
 * configuration failed), 2 another migrate or provision-practice run holds the lock.
 */
const usage =
  'usage: provision-practice --slug <slug> --name <name> --manager-handle <handle> --manager-name <name> --location-name <name> [--time-zone <IANA zone>] [--languages az,ru]'

/** The option each argument comes from, so the log can name an invalid one without its value. */
const optionNames: Record<string, string> = {
  slug: '--slug',
  name: '--name',
  managerHandle: '--manager-handle',
  managerName: '--manager-name',
  locationName: '--location-name',
  timeZone: '--time-zone',
  languages: '--languages',
}

function exitCode(outcome: ProvisionOutcome): number {
  switch (outcome.status) {
    case 'provisioned':
      return 0
    case 'lock-held':
      return 2
    case 'slug-taken':
    case 'failed':
    case 'password-rejected':
      return 1
  }
}

async function main(): Promise<number> {
  let values: {
    slug?: string
    name?: string
    'manager-handle'?: string
    'manager-name'?: string
    'location-name'?: string
    'time-zone'?: string
    languages?: string
  }
  try {
    // `pnpm provision-practice -- --slug …` hands the `--` on to node, which passes it to the script: drop it.
    const args = process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2)
    values = parseArgs({
      args,
      options: {
        slug: { type: 'string' },
        name: { type: 'string' },
        'manager-handle': { type: 'string' },
        'manager-name': { type: 'string' },
        'location-name': { type: 'string' },
        'time-zone': { type: 'string' },
        languages: { type: 'string' },
      },
      strict: true,
    }).values
  } catch (error) {
    // The parser's message quotes the stray token, which can be part of a name: log its code only.
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown'
    log.fatal({ code }, usage)
    return 1
  }

  const parsed = provisionInput.safeParse({
    slug: values.slug,
    name: values.name,
    managerHandle: values['manager-handle'],
    managerName: values['manager-name'],
    locationName: values['location-name'],
    timeZone: values['time-zone'],
    languages: values.languages?.split(',').map((code) => code.trim()),
  })
  if (!parsed.success) {
    const invalid = parsed.error.issues.map((issue) => {
      const argument = String(issue.path[0])
      return { option: optionNames[argument] ?? argument, problem: issue.message }
    })
    log.fatal({ invalid }, usage)
    return 1
  }

  let url: string
  try {
    url = loadMigratorConfig().DATABASE_URL_MIGRATOR
    // The manager's login goes through Better Auth, which reads the API's own configuration (src/platform/config.ts).
    loadConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      log.fatal({ variables: error.variables }, error.message)
      return 1
    }
    throw error
  }

  try {
    const outcome = await provisionPractice({
      url,
      input: parsed.data,
      managerPassword: () => readPassword("the manager's password"),
      log,
    })
    if (outcome.status === 'provisioned') console.log(outcome.practiceId)
    if (outcome.status === 'password-rejected') {
      log.fatal(
        { problem: outcome.problem },
        'the password needs 10 to 128 characters; nothing after the grants changed',
      )
    }
    return exitCode(outcome)
  } catch (error) {
    log.fatal({ err: scrubError(error) }, 'provision-practice did not complete')
    return 1
  } finally {
    await closeDatabase()
  }
}

process.exitCode = await main()

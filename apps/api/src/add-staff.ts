import { parseArgs } from 'node:util'
import { addStaff, staffInput } from './modules/identity-access/index.js'
import { ConfigError, loadConfig, loadMigratorConfig } from './platform/config.js'
import { closeDatabase } from './platform/db/index.js'
import { log as baseLog, scrubError } from './platform/log.js'
import { readPassword } from './platform/prompt.js'

/**
 * `add-staff`: gives a staff member a login and their roles at a practice (spec #18, "Commands"; story 14), through
 * the staff service (src/modules/identity-access), until feature 15's staff screen puts the same service behind a
 * page. Locally `pnpm --filter @vetora/api add-staff -- --practice alfa --handle dr.leyla --name "Leyla Həsənova"
 * --roles veterinarian`; on a server `node apps/api/dist/add-staff.js …` through `kamal app exec`. The password is
 * asked at a hidden prompt, or read from standard input when it is not a terminal, and only when the login is created
 * (src/platform/prompt.ts); never an argument. A rerun with the same handle completes what is missing and changes
 * nothing else. Prints the login id.
 *
 * Exit codes: 0 the staff member is in place (a rerun included), 1 an argument or the password is invalid, the
 * practice code names no active practice, or the run did not complete.
 */
const usage =
  'usage: add-staff --practice <code> --handle <handle> --name <name> --roles <role>[,<role>…] (manager, veterinarian, assistant, receptionist, groomer)'

const log = baseLog.child({ command: 'add-staff' })

const optionNames: Record<string, string> = {
  practiceCode: '--practice',
  handle: '--handle',
  name: '--name',
  roles: '--roles',
}

async function main(): Promise<number> {
  let values: { practice?: string; handle?: string; name?: string; roles?: string }
  try {
    const args = process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2)
    values = parseArgs({
      args,
      options: {
        practice: { type: 'string' },
        handle: { type: 'string' },
        name: { type: 'string' },
        roles: { type: 'string' },
      },
      strict: true,
    }).values
  } catch (error) {
    // The parser's message quotes the stray token, which can be a password typed as an argument: log its code only.
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown'
    log.fatal({ code }, usage)
    return 1
  }

  const parsed = staffInput.safeParse({
    practiceCode: values.practice,
    handle: values.handle,
    name: values.name,
    roles: values.roles?.split(',').map((role) => role.trim()),
  })
  if (!parsed.success) {
    const invalid = parsed.error.issues.map((issue) => {
      const argument = String(issue.path[0])
      return { option: optionNames[argument] ?? argument, problem: issue.message }
    })
    log.fatal({ invalid }, usage)
    return 1
  }

  let migratorUrl: string
  try {
    migratorUrl = loadMigratorConfig().DATABASE_URL_MIGRATOR
    // The login goes through Better Auth, which reads the API's own configuration (src/platform/config.ts).
    loadConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      log.fatal({ variables: error.variables }, error.message)
      return 1
    }
    throw error
  }

  try {
    const outcome = await addStaff({
      migratorUrl,
      input: parsed.data,
      password: () => readPassword('the password'),
    })
    switch (outcome.status) {
      case 'in-place':
        log.info(
          { practiceId: outcome.practiceId, userId: outcome.userId, roles: outcome.roles, written: outcome.written },
          'staff member in place',
        )
        console.log(outcome.userId)
        return 0
      case 'no-practice':
        log.fatal({ practiceCode: parsed.data.practiceCode }, 'no active practice has this code; nothing changed')
        return 1
      case 'password-rejected':
        log.fatal({ problem: outcome.problem }, 'the password needs 10 to 128 characters; nothing changed')
        return 1
    }
  } catch (error) {
    log.fatal({ err: scrubError(error) }, 'add-staff did not complete')
    return 1
  } finally {
    await closeDatabase()
  }
}

process.exitCode = await main()

import { parseArgs } from 'node:util'
import { unlockInput, unlockLogin } from './modules/identity-access/index.js'
import { ConfigError, loadConfig } from './platform/config.js'
import { closeDatabase } from './platform/db/index.js'
import { log as baseLog, scrubError } from './platform/log.js'

/**
 * `unlock-login`: frees a username the sign in lock holds at once, so a staff member locked out by five wrong
 * passwords works again before the 15 minutes pass (spec #18, "Commands"; #20; story 17), through the staff service;
 * feature 15 gives the manager a button for it. Locally
 * `pnpm --filter @vetora/api unlock-login -- --practice alfa --handle dr.leyla`; on a server
 * `node apps/api/dist/unlock-login.js …` through `kamal app exec`. The lock counts any username, so this frees one
 * whether a login has it or not.
 *
 * Exit codes: 0 the username is free (it was locked or counting failures, or it was not), 1 an argument is invalid or
 * the run did not complete.
 */
const usage = 'usage: unlock-login --practice <code> --handle <handle>'

const log = baseLog.child({ command: 'unlock-login' })

const optionNames: Record<string, string> = { practiceCode: '--practice', handle: '--handle' }

async function main(): Promise<number> {
  let values: { practice?: string; handle?: string }
  try {
    const args = process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2)
    values = parseArgs({
      args,
      options: { practice: { type: 'string' }, handle: { type: 'string' } },
      strict: true,
    }).values
  } catch (error) {
    // The parser's message quotes the stray token: log its code only.
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown'
    log.fatal({ code }, usage)
    return 1
  }

  const parsed = unlockInput.safeParse({ practiceCode: values.practice, handle: values.handle })
  if (!parsed.success) {
    const invalid = parsed.error.issues.map((issue) => {
      const argument = String(issue.path[0])
      return { option: optionNames[argument] ?? argument, problem: issue.message }
    })
    log.fatal({ invalid }, usage)
    return 1
  }

  try {
    loadConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      log.fatal({ variables: error.variables }, error.message)
      return 1
    }
    throw error
  }

  try {
    const outcome = await unlockLogin(parsed.data)
    if (outcome.status === 'unlocked') log.info('login unlocked')
    else log.info('this username was not locked; nothing changed')
    return 0
  } catch (error) {
    log.fatal({ err: scrubError(error) }, 'unlock-login did not complete')
    return 1
  } finally {
    await closeDatabase()
  }
}

process.exitCode = await main()

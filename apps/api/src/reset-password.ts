import { parseArgs } from 'node:util'
import { resetInput, resetStaffPassword } from './modules/identity-access/index.js'
import { ConfigError, loadConfig } from './platform/config.js'
import { closeDatabase } from './platform/db/index.js'
import { log as baseLog, scrubError } from './platform/log.js'
import { readPassword } from './platform/prompt.js'

/**
 * `reset-password`: replaces a staff member's password and ends every session they have open, so a forgotten or
 * leaked password is replaced in one step (spec #18, "Commands"; story 16), through the staff service. Locally
 * `pnpm --filter @vetora/api reset-password -- --practice alfa --handle dr.leyla`; on a server
 * `node apps/api/dist/reset-password.js …` through `kamal app exec`. The new password is asked at a hidden prompt, or
 * read from standard input when it is not a terminal (src/platform/prompt.ts); never an argument.
 *
 * Exit codes: 0 the password is replaced, 1 an argument or the password is invalid, no login has the handle at that
 * practice, or the run did not complete.
 */
const usage = 'usage: reset-password --practice <code> --handle <handle>'

const log = baseLog.child({ command: 'reset-password' })

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
    // The parser's message quotes the stray token, which can be a password typed as an argument: log its code only.
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown'
    log.fatal({ code }, usage)
    return 1
  }

  const parsed = resetInput.safeParse({ practiceCode: values.practice, handle: values.handle })
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
    const outcome = await resetStaffPassword(parsed.data, () => readPassword('the new password'))
    switch (outcome.status) {
      case 'reset':
        log.info({ userId: outcome.userId, sessionsEnded: outcome.sessionsEnded }, 'password replaced, sessions ended')
        return 0
      case 'no-login':
        log.fatal(
          { practiceCode: parsed.data.practiceCode },
          'no login has this handle at this practice; nothing changed',
        )
        return 1
      case 'password-rejected':
        log.fatal({ problem: outcome.problem }, 'the password needs 10 to 128 characters; nothing changed')
        return 1
    }
  } catch (error) {
    log.fatal({ err: scrubError(error) }, 'reset-password did not complete')
    return 1
  } finally {
    await closeDatabase()
  }
}

process.exitCode = await main()

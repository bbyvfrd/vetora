import { createInterface } from 'node:readline'

/**
 * Passwords for the operator commands (spec #18, "Commands"; story 15): never an argument, so none lands in shell
 * history or a process listing. On a terminal the command asks at a hidden prompt, twice; when standard input is not a
 * terminal (`kamal app exec` with a pipe, the tests) its first line is the password. The prompt goes to stderr, so
 * stdout keeps what a script reads (the practice id).
 */

export class PasswordMismatch extends Error {
  constructor() {
    super('the two passwords typed differ')
    this.name = 'PasswordMismatch'
  }
}

/** Read a password for `purpose` ("the manager's password"); throws PasswordMismatch when the two typed differ. */
export async function readPassword(purpose: string): Promise<string> {
  if (!process.stdin.isTTY) return firstLine()
  const first = await hidden(`Type ${purpose}: `)
  const again = await hidden(`Type ${purpose} again: `)
  if (first !== again) throw new PasswordMismatch()
  return first
}

/** The first line of a piped standard input, or '' when it is empty. */
async function firstLine(): Promise<string> {
  const lines = createInterface({ input: process.stdin, terminal: false })
  try {
    for await (const line of lines) return line
    return ''
  } finally {
    lines.close()
  }
}

/** One line typed at the terminal with nothing echoed; Backspace deletes, Ctrl-C cancels. */
function hidden(label: string): Promise<string> {
  const stdin = process.stdin
  return new Promise((resolve, reject) => {
    let value = ''
    const done = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stderr.write('\n')
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          done()
          resolve(value)
          return
        }
        if (char === '\u0003') {
          done()
          reject(new Error('cancelled at the password prompt'))
          return
        }
        value = char === '\u007f' || char === '\b' ? value.slice(0, -1) : value + char
      }
    }
    process.stderr.write(label)
    stdin.setEncoding('utf8')
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  })
}

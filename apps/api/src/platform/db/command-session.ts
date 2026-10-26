import pg from 'pg'

/**
 * An operator command's connection (spec 0001, "Provisioning"; spec #18, "Commands"): one direct `pg.Client` as
 * vetora_migrator on DATABASE_URL_MIGRATOR, with `app.migration` set to the command's name for the session, so every
 * practice row it writes is audited as `migration:<command>` (IN-1: a write without an actor is a migration's and says
 * so; apps/api/docs/database.md, "Actor and audit"). The handle a module's command code is given in place of a database
 * client, which only src/platform may create.
 */

/** @public */
export type CommandSession = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number }>
  /** Runs `work` in one transaction: committed when it returns, rolled back when it throws. */
  transaction<T>(work: () => Promise<T>): Promise<T>
}

/**
 * Open the command's session, run `work` on it, close it.
 * @public
 */
export async function withCommandSession<T>(
  options: { url: string; command: string },
  work: (session: CommandSession) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: options.url, application_name: `vetora-${options.command}` })
  await client.connect()
  try {
    await client.query("select set_config('app.migration', $1, false)", [options.command])
    const session: CommandSession = {
      query: async <Row extends Record<string, unknown>>(text: string, values?: unknown[]) => {
        const result = await client.query<Row>(text, values)
        return { rows: result.rows, rowCount: result.rowCount ?? 0 }
      },
      transaction: async (run) => {
        await client.query('begin')
        try {
          const result = await run()
          await client.query('commit')
          return result
        } catch (error) {
          await client.query('rollback')
          throw error
        }
      },
    }
    return await work(session)
  } finally {
    await client.end()
  }
}

/**
 * A schema or table name quoted for SQL text: a practice schema's name carries its UUID with hyphens.
 * @public
 */
export const quoteIdentifier: (name: string) => string = pg.escapeIdentifier

import { rootCause } from '../log.js'

/**
 * The rule errors the database raises (spec 0002, "Interface surface"; docs/domain.md §8): a RAISE EXCEPTION whose
 * MESSAGE starts with the rule name and whose SQLSTATE is a five character code in the VT class, one per rule, so a
 * handler can map a failed statement or commit (a deferred check surfaces at COMMIT) to a problem detail by the code
 * alone. The message names the rule and nothing personal; scrubError() drops detail, hint, and where as for any
 * Postgres error. A new rule adds its row here and raises the same code in its function.
 */
export const ruleErrors = {
  /** IN-1: a write with app.actor_id unset or empty on a session other than vetora_migrator (current_actor()). */
  'vetora.no_actor': 'VT001',
} as const satisfies Record<`vetora.${string}`, `VT${string}`>

export type RuleName = keyof typeof ruleErrors
type RuleCode = (typeof ruleErrors)[RuleName]

const rulesByCode = new Map<string, RuleName>(
  (Object.entries(ruleErrors) as [RuleName, RuleCode][]).map(([name, code]) => [code, name]),
)

/**
 * The rule a failed query or commit broke, from the SQLSTATE of the Postgres error at the root of `error` (Drizzle
 * wraps it as the `cause`); undefined for any other error.
 */
export function ruleOf(error: unknown): RuleName | undefined {
  const root = rootCause(error)
  if (!root || typeof root !== 'object' || !('code' in root) || typeof root.code !== 'string') return undefined
  return rulesByCode.get(root.code)
}

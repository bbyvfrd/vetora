import { rootCause } from '../log.js'

/**
 * The rule errors the database raises (spec 0002, "Interface surface"; docs/domain.md §8): a RAISE EXCEPTION whose
 * MESSAGE starts with the rule name and whose SQLSTATE is a five character code in the VT class, one per rule (the
 * deferred checks share one and name their rule in the message), so a handler can map a failed statement or commit (a
 * deferred check surfaces at COMMIT) to a problem detail by the code. The message names the rule, and at most a table, column, or status, nothing personal; scrubError() drops
 * detail, hint, and where as for any Postgres error. A new rule adds its row here and raises the same code in its
 * function; the deferred checks share one code (INCOMPLETE_RULE_CODE) and name their rule in the message.
 */
export const ruleErrors = {
  /** IN-1: a write with app.actor_id unset or empty on a session other than vetora_migrator (current_actor()). */
  'vetora.no_actor': 'VT001',
  /** AC-9, and CR-1, RX-4, BL-6 behind it: a set once column changed after it was set, or a set once class row changed outside its named columns (set_once()). */
  'vetora.set_once': 'VT002',
  /** CR-1, RX-4, BL-3, BL-6, IN-6: a frozen row, or a child row of one, changed or deleted (freeze_record(), lock_parent()). */
  'vetora.frozen_record': 'VT003',
  /** AC-13: occurred_at earlier than now() minus practice_settings.backdate_limit_hours (assert_backdate_limit()); the future half is the table's CHECK. */
  'vetora.backdated_too_far': 'VT004',
} as const satisfies Record<`vetora.${string}`, `VT${string}`>

/**
 * The deferred checks' family (RX-3, IN-3; AC-3, AC-12; spec 0002, "Who writes", "Interface surface": assert_*):
 * every deferred assert_<rule>() constraint trigger raises this one code when the transaction commits, with the
 * message `vetora.incomplete_<rule>: <missing row>`, so a handler maps a failed commit by the code and reads which rule
 * and which companion row from the message (ruleOf(), missingRowOf()). A new deferred check adds no row above: its
 * rule name is the message's. (assert_backdate_limit() is immediate, named by its ticket, and has VT004 above.)
 */
export const INCOMPLETE_RULE_CODE = 'VT005'

/** A deferred check's rule, as its message starts. */
export type IncompleteRule = `vetora.incomplete_${string}`

export type RuleName = keyof typeof ruleErrors | IncompleteRule
type RuleCode = (typeof ruleErrors)[keyof typeof ruleErrors]

const rulesByCode = new Map<string, RuleName>(
  (Object.entries(ruleErrors) as [RuleName, RuleCode][]).map(([name, code]) => [code, name]),
)

/**
 * The rule a failed query or commit broke, from the SQLSTATE of the Postgres error at the root of `error` (Drizzle
 * wraps it as the `cause`), and for a deferred check from its message; undefined for any other error.
 */
export function ruleOf(error: unknown): RuleName | undefined {
  const root = postgresError(error)
  if (!root) return undefined
  if (root.code === INCOMPLETE_RULE_CODE) return incompleteOf(root.message)?.rule
  return rulesByCode.get(root.code)
}

/** The companion row a deferred check found missing when the transaction committed, by table name; undefined for any other error. */
export function missingRowOf(error: unknown): string | undefined {
  const root = postgresError(error)
  return root?.code === INCOMPLETE_RULE_CODE ? incompleteOf(root.message)?.missing : undefined
}

const INCOMPLETE_MESSAGE = /^(vetora\.incomplete_[a-z0-9_]+): (\S.*)$/

function incompleteOf(message: string): { rule: IncompleteRule; missing: string } | undefined {
  const match = INCOMPLETE_MESSAGE.exec(message)
  const [, rule, missing] = match ?? []
  if (!rule || !missing) return undefined
  return { rule: rule as IncompleteRule, missing }
}

/** The Postgres error at the root of the cause chain, when there is one: its SQLSTATE and message. */
function postgresError(error: unknown): { code: string; message: string } | undefined {
  const root = rootCause(error)
  if (!root || typeof root !== 'object' || !('code' in root) || typeof root.code !== 'string') return undefined
  return { code: root.code, message: 'message' in root && typeof root.message === 'string' ? root.message : '' }
}

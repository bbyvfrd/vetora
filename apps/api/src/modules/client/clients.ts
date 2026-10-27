import { and, asc, eq, inArray } from 'drizzle-orm'
import type { LangCode } from '../../platform/db/domains.js'
import { practiceContext } from '../../platform/request-context.js'
import { client, clientContact } from './schema.js'

/**
 * The Client module's work for a request (spec #18, "Tables": the client module; #21): the clients a phone number
 * reaches, and a client registered with their phone. Everything runs in the request's transaction (practiceContext()),
 * as the actor. Names and numbers are personal data: nothing here logs them.
 */

/** The contact kinds that hold a phone number, stored in E.164. */
const PHONE_KINDS = ['phone', 'whatsapp', 'telegram'] as const

export type ClientMatch = {
  id: string
  firstName: string | null
  lastName: string | null
  patronymic: string | null
  preferredLanguage: LangCode
}

/**
 * Every active client with a phone contact of this number (E.164), in the order they were registered: none, one, or
 * several, since a family often shares one phone (duplicates are warned about, never blocked).
 */
export async function findClientsByPhone(phone: string): Promise<ClientMatch[]> {
  const { db } = practiceContext()
  const holders = db
    .select({ id: clientContact.clientId })
    .from(clientContact)
    .where(and(eq(clientContact.valueNormalised, phone), inArray(clientContact.kind, [...PHONE_KINDS])))
  return db
    .select({
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      patronymic: client.patronymic,
      preferredLanguage: client.preferredLanguage,
    })
    .from(client)
    .where(and(inArray(client.id, holders), eq(client.status, 'active')))
    .orderBy(asc(client.createdAt), asc(client.id))
}

export type ClientInput = {
  id: string
  firstName: string
  lastName: string
  patronymic?: string | null
  preferredLanguage: LangCode
  /** As typed. */
  phone: string
  /** The same number in E.164 (the contracts' normalisePhone()). */
  phoneNormalised: string
}

/**
 * Register a person with their phone as the primary contact; the same id again changes nothing and answers
 * `existing`.
 */
export async function registerClient(input: ClientInput): Promise<'created' | 'existing'> {
  const { db } = practiceContext()
  const created = await db
    .insert(client)
    .values({
      id: input.id,
      kind: 'person',
      firstName: input.firstName,
      lastName: input.lastName,
      patronymic: input.patronymic || null,
      preferredLanguage: input.preferredLanguage,
    })
    .onConflictDoNothing({ target: client.id })
    .returning({ id: client.id })
  if (created.length === 0) return 'existing'
  await db.insert(clientContact).values({
    clientId: input.id,
    kind: 'phone',
    value: input.phone,
    valueNormalised: input.phoneNormalised,
    isPrimary: true,
  })
  return 'created'
}

/** Whether an active client has this id. */
export async function clientExists(id: string): Promise<boolean> {
  const { db } = practiceContext()
  const [row] = await db
    .select({ id: client.id })
    .from(client)
    .where(and(eq(client.id, id), eq(client.status, 'active')))
  return row !== undefined
}

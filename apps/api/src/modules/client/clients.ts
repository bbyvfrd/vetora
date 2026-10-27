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

/** A client's name, as the clinic writes it from its three parts. */
export type ClientName = { id: string; firstName: string | null; lastName: string | null; patronymic: string | null }

const NAME_COLUMNS = {
  id: client.id,
  firstName: client.firstName,
  lastName: client.lastName,
  patronymic: client.patronymic,
}

/** What a patient header shows of its owner (#22): the name, and the primary phone as it was typed. */
export async function clientCard(id: string): Promise<(ClientName & { phone: string | null }) | undefined> {
  const { db } = practiceContext()
  const [row] = await db
    .select({ ...NAME_COLUMNS, phone: clientContact.value })
    .from(client)
    .leftJoin(clientContact, and(eq(clientContact.clientId, client.id), eq(clientContact.isPrimary, true)))
    .where(eq(client.id, id))
  return row
}

/** The clients' names by id (#22: the rows of Visits today). */
export async function clientNames(ids: readonly string[]): Promise<Map<string, ClientName>> {
  if (ids.length === 0) return new Map()
  const { db } = practiceContext()
  const rows = await db
    .select(NAME_COLUMNS)
    .from(client)
    .where(inArray(client.id, [...ids]))
  return new Map(rows.map((row) => [row.id, row]))
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

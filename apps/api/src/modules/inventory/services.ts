import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { PRACTICE_CODE } from '../../platform/auth/names.js'
import { quoteIdentifier, withCommandSession } from '../../platform/db/command-session.js'
import { CURRENCY_CODES, type CurrencyCode, LANG_CODES } from '../../platform/db/domains.js'
import { practiceContext } from '../../platform/request-context.js'
import { SERVICE_CATEGORIES, service } from './schema.js'

/**
 * The price list (spec #18, "Commands": load-services; stories 18 and 57; #25): loaded from a file by the operator
 * until feature 15's screen, read by the visit page's search, and priced into an invoice line by billing. Loading runs
 * as the migrator, every row audited as `migration:load-services`; reading runs in the request's transaction
 * (practiceContext()).
 */

/** A name on the price list, in one language. */
const ServiceName = z.string().trim().min(1).max(200)

/**
 * One service of the file: its names in the three languages (at least one, as the table requires), its category, and
 * its price in minor units with the currency (IN-4).
 */
export const serviceEntry = z.object({
  names: z
    .object({ az: ServiceName.optional(), ru: ServiceName.optional(), en: ServiceName.optional() })
    .refine((names) => Boolean(names.az ?? names.ru ?? names.en), 'at least one name'),
  category: z.enum(SERVICE_CATEGORIES),
  priceMinor: z.int().nonnegative(),
  currency: z.enum(CURRENCY_CODES),
})

/** The file `load-services` reads: a JSON array of services. */
export const servicesFile = z.array(serviceEntry).min(1)

export type ServiceEntry = z.output<typeof serviceEntry>

/** The arguments of a load, validated. */
export const loadInput = z.object({
  practiceCode: z.string().regex(PRACTICE_CODE, 'a practice code such as alfa'),
})

export type LoadOutcome =
  /** Every entry is on the list: new ones added, changed ones updated, the rest as they were. */
  | { status: 'loaded'; added: number; updated: number; unchanged: number }
  /** The practice code names no active practice: nothing was written. */
  | { status: 'no-practice' }
  /**
   * Entry `entry` (counted from 0) shares a name with an earlier entry of the file, or matches two services already on
   * the list, so which one it means cannot be told: nothing was written.
   */
  | { status: 'ambiguous'; entry: number }

/** Whether two entries name the same service: the same name in any one language, letter case aside. */
const sameService = (a: ServiceEntry, b: ServiceEntry) =>
  LANG_CODES.some((language) => {
    const left = a.names[language]
    const right = b.names[language]
    return left !== undefined && right !== undefined && left.toLowerCase() === right.toLowerCase()
  })

class AmbiguousEntry extends Error {
  constructor(readonly entry: number) {
    super(`entry ${entry} matches more than one service`)
  }
}

/**
 * Load a practice's price list (story 18): each entry is matched to the service with the same name in any of the
 * three languages, letter case aside, and updated (its names where the file gives them, its category and price), or
 * added when none matches, all in one transaction. So a rerun of one file changes nothing, a changed price updates its
 * row, and no service is ever doubled; lines already on invoices keep the price they snapshotted. A service missing
 * from the file stays as it is, and so does `active`, which feature 15's screen sets.
 */
export async function loadServices(options: {
  migratorUrl: string
  practiceCode: string
  services: readonly ServiceEntry[]
}): Promise<LoadOutcome> {
  const { services } = options
  for (const [index, entry] of services.entries()) {
    if (services.slice(0, index).some((earlier) => sameService(earlier, entry))) {
      return { status: 'ambiguous', entry: index }
    }
  }
  return withCommandSession({ url: options.migratorUrl, command: 'load-services' }, async (session) => {
    const registry = await session.query<{ schema_name: string }>(
      `select schema_name from control.practice where slug = $1 and status = 'active'`,
      [options.practiceCode],
    )
    const schema = registry.rows[0]?.schema_name
    if (!schema) return { status: 'no-practice' }
    const table = `${quoteIdentifier(schema)}.service`
    try {
      return await session.transaction(async () => {
        const outcome = { status: 'loaded' as const, added: 0, updated: 0, unchanged: 0 }
        for (const [index, entry] of services.entries()) {
          const names = [entry.names.az ?? null, entry.names.ru ?? null, entry.names.en ?? null]
          const found = await session.query<{ id: string }>(
            `select id from ${table}
             where lower(name_az) = lower($1) or lower(name_ru) = lower($2) or lower(name_en) = lower($3)`,
            names,
          )
          const [match, another] = found.rows
          if (another) throw new AmbiguousEntry(index)
          const values = [...names, entry.category, entry.priceMinor, entry.currency]
          if (!match) {
            await session.query(
              `insert into ${table} (name_az, name_ru, name_en, category, price_minor, currency)
               values ($1, $2, $3, $4, $5, $6)`,
              values,
            )
            outcome.added += 1
            continue
          }
          // Only a row that differs is written, so a rerun leaves the version and the audit log as they were.
          const changed = await session.query(
            `update ${table}
             set name_az = coalesce($2, name_az), name_ru = coalesce($3, name_ru), name_en = coalesce($4, name_en),
                 category = $5, price_minor = $6, currency = $7
             where id = $1
               and (name_az, name_ru, name_en, category, price_minor, currency) is distinct from
                   (coalesce($2, name_az), coalesce($3, name_ru), coalesce($4, name_en), $5::text, $6::bigint, $7::text)`,
            [match.id, ...values],
          )
          if (changed.rowCount === 1) outcome.updated += 1
          else outcome.unchanged += 1
        }
        return outcome
      })
    } catch (error) {
      if (error instanceof AmbiguousEntry) return { status: 'ambiguous', entry: error.entry }
      throw error
    }
  })
}

/** A service as the visit page's search shows it: its names, its category and its price. */
export type PricedService = {
  id: string
  names: { az: string | null; ru: string | null; en: string | null }
  category: (typeof SERVICE_CATEGORIES)[number]
  priceMinor: bigint
  currency: CurrencyCode
}

const pricedColumns = {
  id: service.id,
  nameAz: service.nameAz,
  nameRu: service.nameRu,
  nameEn: service.nameEn,
  category: service.category,
  priceMinor: service.priceMinor,
  currency: service.currency,
}

type ServiceRow = Omit<PricedService, 'names'> & { nameAz: string | null; nameRu: string | null; nameEn: string | null }

const priced = ({ nameAz, nameRu, nameEn, ...row }: ServiceRow): PricedService => ({
  ...row,
  names: { az: nameAz, ru: nameRu, en: nameEn },
})

/** The services on the price list that are active (story 57: searched by name in the person's language). */
export async function priceList(): Promise<PricedService[]> {
  const { db } = practiceContext()
  const rows = await db.select(pricedColumns).from(service).where(eq(service.active, true)).orderBy(asc(service.id))
  return rows.map(priced)
}

/**
 * A service an invoice line is about to snapshot (spec 0002, "Value sourcing": Add an invoice line): its three names
 * and its price now; undefined when there is no such service or it is no longer active.
 */
export async function serviceForLine(id: string): Promise<PricedService | undefined> {
  const { db } = practiceContext()
  const [row] = await db
    .select(pricedColumns)
    .from(service)
    .where(and(eq(service.id, id), eq(service.active, true)))
  return row ? priced(row) : undefined
}

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './platform/db/migrator.js'
import {
  connectTestClient,
  databaseTestsEnabled,
  escapeIdentifier as ident,
  resetTestDatabase,
  type TestClient,
  type TestDatabaseUrls,
  testDatabaseUrls,
} from './platform/db/test-support.js'
import { uuidv7 } from './platform/ids.js'
import { type ApiPractice, commandEnv, provisionApiPractice, runCommand } from './test-support.js'

/**
 * `load-services` (spec #18, "Commands"; story 18; #25) through the shipped entry point, as `kamal app exec` runs it,
 * reading a file of services: a rerun of one file leaves one row per service, a changed price updates its row, and a
 * line an invoice took before keeps the price it snapshotted (spec 0002, "Value sourcing": Add an invoice line), which
 * is read through the API (seam 2). A case runs the command up to three times, each a Node start through tsx, hence
 * the timeouts (staff-commands.test.ts says why).
 */
describe.skipIf(!databaseTestsEnabled())('load-services (spec #18, Commands; #25)', () => {
  let urls: TestDatabaseUrls
  let migrator: TestClient
  let practice: ApiPractice
  let folder: string

  const priceList = [
    {
      names: { az: 'Müayinə', ru: 'Осмотр', en: 'Consultation' },
      category: 'consultation',
      priceMinor: 2500,
      currency: 'AZN',
    },
    {
      names: { az: 'Peyvənd', ru: 'Вакцинация', en: 'Vaccination' },
      category: 'procedure',
      priceMinor: 1850,
      currency: 'AZN',
    },
  ]

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = await connectTestClient(urls.migrator, 'load-services.test')
    practice = await provisionApiPractice(urls)
    folder = await mkdtemp(join(tmpdir(), 'vetora-load-services-'))
  }, 30_000)

  afterAll(async () => {
    await practice?.drop()
    await migrator?.end()
    if (folder) await rm(folder, { recursive: true, force: true })
  })

  /** Write `content` to a file of the test's folder and run the command on it for the test practice. */
  async function load(content: unknown, name = `${uuidv7()}.json`, practiceCode = practice.slug) {
    const file = join(folder, name)
    await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content))
    return runCommand('load-services', ['--practice', practiceCode, '--file', file], commandEnv(urls))
  }

  const rows = async () =>
    (
      await migrator.query<{ name_en: string; price_minor: string; version: number }>(
        `select name_en, price_minor, version from ${ident(practice.schema)}.service order by name_en`,
      )
    ).rows

  it('run twice on one file leaves one row per service; a changed price updates that row, and a line added before keeps its old price', async () => {
    const first = await load(priceList)
    expect(first.code, first.stdout).toBe(0)
    expect(first.lines.at(-1)).toMatchObject({ msg: 'services loaded', added: 2, updated: 0, unchanged: 0 })
    const again = await load(priceList)
    expect(again.code).toBe(0)
    expect(again.lines.at(-1)).toMatchObject({ added: 0, updated: 0, unchanged: 2 })
    expect(await rows()).toEqual([
      { name_en: 'Consultation', price_minor: '2500', version: 1 },
      { name_en: 'Vaccination', price_minor: '1850', version: 1 },
    ])
    const audit = await migrator.query(
      `select distinct source from ${ident(practice.schema)}.audit_event where table_name = 'service'`,
    )
    expect(audit.rows).toEqual([{ source: 'migration:load-services' }])

    // A line on a visit's invoice before the price changes.
    const vet = await practice.addStaff('leyla', ['veterinarian'])
    const species = (await (await practice.request(vet, '/species')).json()) as {
      species: { id: string; code: string }[]
    }
    const visitId = uuidv7()
    const started = await practice.request(vet, `/visits/${visitId}`, {
      method: 'PUT',
      body: {
        client: {
          type: 'new',
          id: uuidv7(),
          firstName: 'Aysel',
          lastName: 'Məmmədova',
          phone: '+994 50 123 45 67',
          preferredLanguage: 'az',
        },
        patient: {
          type: 'new',
          id: uuidv7(),
          name: 'Şəkər',
          speciesId: species.species.find((item) => item.code === 'dog')?.id,
          sex: 'female',
          birthDateIsEstimate: false,
          isNeutered: true,
        },
      },
    })
    const { clientId, patientId } = (await started.json()) as { clientId: string; patientId: string }
    const list = (await (await practice.request(vet, '/services')).json()) as {
      services: { id: string; names: { en: string } }[]
    }
    const consultation = list.services.find((item) => item.names.en === 'Consultation')?.id
    const invoiceId = uuidv7()
    const created = await practice.request(vet, `/invoices/${invoiceId}`, {
      method: 'PUT',
      body: { visitId, patientId, clientId, line: { id: uuidv7(), serviceId: consultation, quantity: 1 } },
    })
    expect(created.status).toBe(200)

    const changed = await load([{ ...priceList[0], priceMinor: 3000 }, priceList[1]])
    expect(changed.lines.at(-1)).toMatchObject({ added: 0, updated: 1, unchanged: 1 })
    expect(await rows()).toEqual([
      { name_en: 'Consultation', price_minor: '3000', version: 2 },
      { name_en: 'Vaccination', price_minor: '1850', version: 1 },
    ])
    const invoice = (await (await practice.request(vet, `/visits/${visitId}/invoice`)).json()) as {
      invoice: { lines: { unitPriceMinor: number; totalMinor: number }[] }
    }
    expect(invoice.invoice.lines).toMatchObject([{ unitPriceMinor: 2500, totalMinor: 2500 }])
  }, 30_000)

  it('a name fixed in one language matches by the others; an entry naming two services, or one twice in the file, writes nothing (exit 1)', async () => {
    const renamed = await load([{ ...priceList[1], names: { ...priceList[1]?.names, en: 'Vaccine' } }])
    expect(renamed.lines.at(-1)).toMatchObject({ added: 0, updated: 1 })
    expect((await rows()).map((row) => row.name_en)).toEqual(['Consultation', 'Vaccine'])

    const before = await rows()
    const twoServices = await load([{ ...priceList[0], names: { az: 'Müayinə', en: 'Vaccine' }, priceMinor: 1 }])
    expect(twoServices.code).toBe(1)
    expect(twoServices.lines.at(-1)).toMatchObject({ entry: 0 })
    const twice = await load([priceList[0], { ...priceList[0], names: { ru: 'Осмотр' } }])
    expect(twice.code).toBe(1)
    expect(twice.lines.at(-1)).toMatchObject({ entry: 1 })
    expect(await rows()).toEqual(before)
  }, 30_000)

  it('refuses a file that is not a list of services, an unknown practice, and missing arguments, exit 1, writing nothing', async () => {
    const before = await rows()
    for (const content of [
      'not json',
      [],
      [{ ...priceList[0], names: {} }],
      [{ ...priceList[0], priceMinor: 25.5 }],
      [{ ...priceList[0], category: 'surgery' }],
      [{ ...priceList[0], currency: 'USD' }],
    ]) {
      const run = await load(content)
      expect(run.code, JSON.stringify(content)).toBe(1)
    }
    const unknown = await load(priceList, undefined, 'no-such-practice')
    expect(unknown.code).toBe(1)
    const missing = await runCommand('load-services', ['--practice', practice.slug], commandEnv(urls))
    expect(missing.code).toBe(1)
    expect(await rows()).toEqual(before)
  }, 30_000)
})

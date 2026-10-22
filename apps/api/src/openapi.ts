import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, openApiInfo } from './app.js'

/**
 * Writes the OpenAPI document to packages/contracts/openapi.json; the contracts package turns it
 * into types with openapi-typescript (spec 0001, "Contracts"). Run through `pnpm openapi` at the root.
 */
const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, '../../../packages/contracts/openapi.json')
const document = app.getOpenAPI31Document({ ...openApiInfo, info: { ...openApiInfo.info, version: '0.1.0' } })

await mkdir(dirname(target), { recursive: true })
await writeFile(target, `${JSON.stringify(document, null, 2)}\n`)
console.log(`wrote ${target}`)

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { configVariables } from './config.js'

/**
 * Every place a configuration variable must be named before a server can read it (AGENTS.md, Conventions: a new
 * configuration variable): the zod schemas in config.ts, `.env.example`, each app's Kamal config and destinations, the
 * Kamal secrets file, and the staging workflow that runs Kamal in CI. Each is edited by hand, so the test reads them all;
 * `BETTER_AUTH_SECRET` (#19) and `DATABASE_URL_MIGRATOR` (#2) both reached the Kamal secrets without the workflow.
 */

type KamalConfig = {
  registry?: { password?: string[] }
  builder?: { secrets?: string[] }
  env?: { clear?: Record<string, unknown>; secret?: string[] }
}

type Workflow = { jobs: Record<string, { env?: Record<string, unknown> }> }

const read = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')
const kamal = (path: string) => parse(read(path)) as KamalConfig

const api = kamal('apps/api/config/deploy.yml')
const web = kamal('apps/clinic-web/config/deploy.yml')
const destinations = ['staging', 'production'].map((name) => ({
  name,
  config: kamal(`apps/api/config/deploy.${name}.yml`),
}))

/** The names a Kamal config reads from the secrets files: the registry password, the build secrets, the runtime secrets. */
const secretsOf = (config: KamalConfig) => [
  ...(config.registry?.password ?? []),
  ...(config.builder?.secrets ?? []),
  ...(config.env?.secret ?? []),
]

/** `.kamal/secrets-common`: each line `NAME=$VARIABLE`, the name Kamal sees and the variables of the shell it reads. */
const secretsCommon = read('.kamal/secrets-common')
  .split('\n')
  .filter((line) => /^[A-Z0-9_]+=/.test(line))
  .map((line) => ({
    name: line.slice(0, line.indexOf('=')),
    reads: [...line.matchAll(/\$\{?([A-Z0-9_]+)\}?/g)].map((match) => match[1]),
  }))

/** `.env.example`: a variable set, or commented out with its name kept (`# SENTRY_DSN_API=`). */
const envExample = new Set(
  read('apps/api/.env.example')
    .split('\n')
    .map((line) => line.match(/^#?\s*([A-Z0-9_]+)=/)?.[1])
    .filter((name) => name !== undefined),
)

const workflow = parse(read('.github/workflows/deploy-staging.yml')) as Workflow
const exported = new Set(Object.values(workflow.jobs).flatMap((job) => Object.keys(job.env ?? {})))

/** The names a place lacks: what each case asserts is empty. */
const missing = (names: readonly string[], place: ReadonlySet<string>) => names.filter((name) => !place.has(name))

describe('the deploy files name every variable the API reads', () => {
  it('reads every file it compares', () => {
    expect(configVariables).toEqual(expect.arrayContaining(['BETTER_AUTH_SECRET', 'DATABASE_URL_MIGRATOR']))
    expect(secretsOf(api)).toEqual(expect.arrayContaining(['KAMAL_REGISTRY_PASSWORD', 'DATABASE_URL_POOLED']))
    expect(secretsOf(web)).toEqual(expect.arrayContaining(['SENTRY_AUTH_TOKEN', 'SENTRY_DSN_WEB']))
    expect(secretsCommon.map((secret) => secret.name)).toContain('KAMAL_REGISTRY_PASSWORD')
    expect(secretsCommon.flatMap((secret) => secret.reads)).toContain('KAMAL_REGISTRY_PASSWORD')
    expect(exported).toContain('KAMAL_REGISTRY_PASSWORD')
  })

  it('lists every variable of config.ts in .env.example', () => {
    expect(missing(configVariables, envExample)).toEqual([])
  })

  it.each(destinations)(
    'gives every variable of config.ts a value on $name, in env.clear or env.secret',
    ({ config }) => {
      const set = new Set([
        ...Object.keys(api.env?.clear ?? {}),
        ...(api.env?.secret ?? []),
        ...Object.keys(config.env?.clear ?? {}),
      ])
      expect(missing(configVariables, set)).toEqual([])
    },
  )

  it('defines every secret the two Kamal configs name in .kamal/secrets-common', () => {
    const defined = new Set(secretsCommon.map((secret) => secret.name))
    expect(missing([...secretsOf(api), ...secretsOf(web)], defined)).toEqual([])
  })

  it('exports every variable .kamal/secrets-common reads from the staging workflow, which runs Kamal in CI', () => {
    const reads = [...new Set(secretsCommon.flatMap((secret) => secret.reads))]
    expect(missing(reads, exported)).toEqual([])
  })
})

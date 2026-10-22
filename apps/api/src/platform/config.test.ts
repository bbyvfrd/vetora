import { describe, expect, it, vi } from 'vitest'

const required = {
  PUBLIC_ORIGIN: 'http://localhost:5173',
  DATABASE_URL_POOLED: 'postgres://vetora_app:secret-value@localhost:5432/vetora',
  DATABASE_URL_DIRECT: 'postgres://vetora_app:secret-value@localhost:5432/vetora',
}

// loadConfig caches its result, so every test loads the module afresh.
async function freshConfig() {
  vi.resetModules()
  return import('./config.js')
}

describe('loadConfig', () => {
  it('fills the defaults from a minimal environment', async () => {
    const { loadConfig } = await freshConfig()
    const config = loadConfig({ ...required })
    expect(config.APP_ENV).toBe('local')
    expect(config.PORT).toBe(3000)
    expect(config.LOG_LEVEL).toBe('info')
    expect(config.SENTRY_DSN_API).toBeUndefined()
  })

  it('names every missing or invalid variable, and never a value', async () => {
    const { ConfigError, loadConfig } = await freshConfig()
    let error: unknown
    try {
      loadConfig({ PUBLIC_ORIGIN: 'not a url', DATABASE_URL_DIRECT: required.DATABASE_URL_DIRECT })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ConfigError)
    expect((error as InstanceType<typeof ConfigError>).variables).toEqual(
      expect.arrayContaining(['PUBLIC_ORIGIN', 'DATABASE_URL_POOLED']),
    )
    expect(String(error)).not.toContain('secret-value')
  })
})

describe('loadMigratorConfig', () => {
  const url = 'postgres://vetora_migrator:secret-value@localhost:5432/vetora'

  it('reads DATABASE_URL_MIGRATOR, which the running API never needs', async () => {
    const { loadMigratorConfig } = await freshConfig()
    expect(loadMigratorConfig({ DATABASE_URL_MIGRATOR: url })).toEqual({ DATABASE_URL_MIGRATOR: url })
  })

  it('fails at startup naming the variable when DATABASE_URL_MIGRATOR is missing or empty', async () => {
    const { ConfigError, loadMigratorConfig } = await freshConfig()
    for (const env of [{}, { DATABASE_URL_MIGRATOR: '' }]) {
      let error: unknown
      try {
        loadMigratorConfig(env)
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as InstanceType<typeof ConfigError>).variables).toEqual(['DATABASE_URL_MIGRATOR'])
    }
  })
})

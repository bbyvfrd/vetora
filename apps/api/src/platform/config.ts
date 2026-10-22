import { z } from 'zod'

/**
 * Runtime configuration, validated once at startup (spec 0001, "Configuration and secrets").
 * Only the variables the scaffold needs are listed; each later feature adds its own.
 */
const schema = z.object({
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** The one origin both apps are served from, e.g. https://app.example.com */
  PUBLIC_ORIGIN: z.url(),
  /** The app role through the connection pooler: request traffic. */
  DATABASE_URL_POOLED: z.string().min(1),
  /** The app role on a direct connection: LISTEN and the worker (later features). */
  DATABASE_URL_DIRECT: z.string().min(1),
  SENTRY_DSN_API: z.string().optional(),
})

export type Config = z.infer<typeof schema>

export class ConfigError extends Error {
  constructor(readonly variables: string[]) {
    super(`Invalid or missing configuration: ${variables.join(', ')}`)
    this.name = 'ConfigError'
  }
}

let cached: Config | undefined

/** Parse and cache the environment. Throws ConfigError naming the variables (never their values). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached
  const result = schema.safeParse(env)
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(root)'))]
    throw new ConfigError(names)
  }
  cached = result.data
  return cached
}

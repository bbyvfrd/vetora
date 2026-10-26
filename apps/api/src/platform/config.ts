import { z } from 'zod'

/**
 * Runtime configuration, validated once at startup (spec 0001, "Configuration and secrets").
 * Only the variables the scaffold needs are listed; each later feature adds its own.
 */
const schema = z.object({
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** The one origin both apps are served from, e.g. https://app.example.com; Better Auth's baseURL and trusted origin. */
  PUBLIC_ORIGIN: z.url(),
  /** Signs Better Auth's session cookies: 32 characters or more, from the Kamal secrets (`openssl rand -base64 32`). */
  BETTER_AUTH_SECRET: z.string().min(32),
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
  cached ??= parse(schema, env)
  return cached
}

/**
 * What the migrate (and later provision) command needs, and the running API never reads
 * (spec 0001, "Configuration and secrets": Migrations).
 */
const migratorSchema = z.object({
  /** vetora_migrator on a direct connection, never the pooler: owns every schema, runs the migrations. */
  DATABASE_URL_MIGRATOR: z.string().min(1),
})

export type MigratorConfig = z.infer<typeof migratorSchema>

/** Parse the command's environment. Throws ConfigError naming the variable (never its value). */
export function loadMigratorConfig(env: NodeJS.ProcessEnv = process.env): MigratorConfig {
  return parse(migratorSchema, env)
}

function parse<T extends z.ZodType>(shape: T, env: NodeJS.ProcessEnv): z.output<T> {
  const result = shape.safeParse(env)
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(root)'))]
    throw new ConfigError(names)
  }
  return result.data
}

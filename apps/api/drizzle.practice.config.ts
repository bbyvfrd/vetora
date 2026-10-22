import { defineConfig } from 'drizzle-kit'

/**
 * The practice set (spec 0002, "Interface surface"): `pnpm db:generate:practice` writes drizzle/practice/<timestamp_name>/
 * migration.sql from src/platform/db/practice-schema.ts. Names stay unqualified: the migrate command applies the folder
 * to every practice schema with search_path set to it and the migrations table inside it, so the schema here is a
 * placeholder drizzle-kit never uses.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/platform/db/practice-schema.ts',
  out: './drizzle/practice',
  migrations: { table: '__drizzle_migrations', schema: 'p_template' },
})

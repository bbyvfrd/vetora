import { defineConfig } from 'drizzle-kit'

/**
 * The control set (spec 0002, "Interface surface"): `pnpm db:generate:control` diffs src/platform/db/control-schema.ts
 * against the last snapshot and writes drizzle/control/<timestamp_name>/migration.sql. The migrate command applies
 * the folder with the same table and schema, so control.__drizzle_migrations is the truth (spec 0001, "Migrations").
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/platform/db/control-schema.ts',
  out: './drizzle/control',
  migrations: { table: '__drizzle_migrations', schema: 'control' },
})

/**
 * The practice set (spec 0002, "Interface surface": Drizzle schema modules): everything drizzle-kit reads through
 * drizzle.practice.config.ts, the migrate command applies once per practice schema, and db() is typed with. The
 * platform tables come first, then every module's schema.ts, empty until its slice arrives. A slice adds a table to its
 * module's schema.ts, registers its class in table-classes.ts, and runs db:generate:practice (src/modules/README.md
 * says how); `import_batch`, `file`, and `issued_document` (spec 0002, "Platform and settings", "Documents and files")
 * join platform-tables.ts with their slices, since files and PDFs are platform concerns (spec 0001, "Repository
 * layout"). This file sits outside src/modules/, so it may import every schema.ts; a module may not import another's
 * (biome.jsonc, noPrivateImports), and schema.test.ts checks that every module is gathered here.
 */
export * from '../../modules/billing/schema.js'
export * from '../../modules/client/schema.js'
export * from '../../modules/client-communication/schema.js'
export * from '../../modules/clinical-record/schema.js'
export * from '../../modules/diagnostics/schema.js'
export * from '../../modules/hospitalization/schema.js'
export * from '../../modules/identity-access/schema.js'
export * from '../../modules/inventory/schema.js'
export * from '../../modules/non-clinical-services/schema.js'
export * from '../../modules/patient/schema.js'
export * from '../../modules/prescription-dispensing/schema.js'
export * from '../../modules/preventive-care/schema.js'
export * from '../../modules/scheduling/schema.js'
export * from './platform-tables.js'

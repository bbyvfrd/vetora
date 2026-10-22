/**
 * The practice set (spec 0002, "Interface surface"): everything drizzle-kit reads through drizzle.practice.config.ts
 * and the migrate command applies once per practice schema. The platform tables live here; each module's schema.ts
 * joins the list when its slice arrives.
 */
export * from './platform-tables.js'

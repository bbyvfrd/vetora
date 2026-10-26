import { boolean, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { control } from '../db/control-schema.js'
import { authTables, createAuth } from './auth.js'

/**
 * A drifted configuration for `auth check schema` to refuse (schema-check.test.ts): the committed one over a
 * control.user that lost its language column, which the configuration's additional field writes. Only the test's CLI
 * run loads it; tsconfig.build.json leaves it out of dist/.
 */
const userWithoutLanguage = control.table('user', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  username: text('username').notNull().unique(),
  displayUsername: text('display_username'),
  role: text('role'),
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires', { withTimezone: true }),
})

export const auth = createAuth({ ...authTables, user: userWithoutLanguage } as typeof authTables)

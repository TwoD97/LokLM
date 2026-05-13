import { sql } from 'drizzle-orm'
import { bigint, check, index, integer, pgTable, text, varchar } from 'drizzle-orm/pg-core'

export const userTable = pgTable(
  'users',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    displayName: varchar('display_name', { length: 32 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: bigint('created_at', { mode: 'number' })
      .notNull()
      .default(sql`EXTRACT(EPOCH FROM NOW())::BIGINT`),
  },
  (table) => [check('display_name_length', sql`length(${table.displayName}) BETWEEN 3 AND 32`)],
)

export const recoveryTable = pgTable(
  'recovery_codes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id')
      .notNull()
      .references(() => userTable.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    createdAt: bigint('created_at', { mode: 'number' })
      .notNull()
      .default(sql`EXTRACT(EPOCH FROM NOW())::BIGINT`),
    usedAt: bigint('used_at', { mode: 'number' }),
  },
  (table) => [
    index('idx_recovery_user')
      .on(table.userId)
      .where(sql`${table.usedAt} IS NULL`),
  ],
)

export type User = typeof userTable.$inferSelect
export type NewUser = typeof userTable.$inferInsert
export type RecoveryCode = typeof recoveryTable.$inferSelect
export type NewRecoveryCode = typeof recoveryTable.$inferInsert

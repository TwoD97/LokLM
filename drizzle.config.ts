import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './drizzle',
  schema: './src/main/db/schema.ts',
  dialect: 'postgresql',
})

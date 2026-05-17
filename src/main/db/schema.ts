// no tables defined yet. real app tables (documents, embeddings, chats,
// citations, ...) will land here. auth metadata lives in the vault header ,
// not in SQL , so theres no users / recovery_codes table.
//
// when the first real table is added , re-introduce drizzle-kit migrations:
//   pnpm db:generate   -> writes drizzle/<n>_<tag>.sql + meta/
// and re-enable migrate() in database.ts.
export {}

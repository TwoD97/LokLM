// better-sqlite3-multiple-ciphers is a drop-in fork of better-sqlite3 with
// SQLite3MultipleCiphers (SQLCipher/AES) compiled in. Its runtime API is
// identical to better-sqlite3, so reuse @types/better-sqlite3's declarations.
declare module 'better-sqlite3-multiple-ciphers' {
  import Database from 'better-sqlite3'
  export = Database
}

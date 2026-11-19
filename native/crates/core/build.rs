fn main() {
    if std::env::var_os("CARGO_FEATURE_STORAGE").is_none() {
        return;
    }
    println!("cargo:rerun-if-changed=vendor/sqlite3mc/sqlite3.c");
    // rusqlite's `sqlcipher` link name is supplied by this exact sqlite3mc
    // implementation. Do not link a system SQLCipher: its format is different.
    let mut build = cc::Build::new();
    build
        .file("vendor/sqlite3mc/sqlite3.c")
        .include("vendor/sqlite3mc")
        .define("SQLITE_CORE", None)
        .define("SQLITE_THREADSAFE", "2")
        .define("SQLITE_DEFAULT_FOREIGN_KEYS", "1")
        .define("SQLITE_DQS", "0")
        .define("SQLITE_ENABLE_COLUMN_METADATA", None)
        .define("SQLITE_ENABLE_FTS5", None)
        .define("SQLITE_ENABLE_RTREE", None)
        .define("SQLITE_ENABLE_STAT4", None)
        .define("SQLITE_TEMP_STORE", "3")
        .define("SQLITE_OMIT_LOAD_EXTENSION", None)
        .warnings(false)
        .flag_if_supported("-std=c99");
    build.compile("sqlcipher");
    #[cfg(target_os = "windows")]
    println!("cargo:rustc-link-lib=bcrypt");
}

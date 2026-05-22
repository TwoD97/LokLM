# LokLM Installer ( Tauri wizard )

The actual installer wizard the user sees when running `LokLM-Setup-*.exe`.
Renders [./frontend/](./frontend/)'s HTML/CSS/JS in a borderless
WebView2 window ; install logic ( file copy , shortcuts , registry ,
uninstaller ) is native Rust in `src-tauri/src/installer.rs`.

Replaces the previous electron-based wizard. Comparison :

|                                 | electron wizard ( old )        | tauri wizard ( this )         |
| ------------------------------- | ------------------------------ | ----------------------------- |
| binary                          | ~300 MB                        | **2.8 MB**                    |
| startup                         | ~3s                            | **~200ms**                    |
| splash flicker                  | 7zSD pre-flash + electron init | boot-splash overlay , instant |
| cmd-window flash during install | none                           | **none** ( CREATE_NO_WINDOW ) |
| design fidelity                 | 100%                           | 100% ( same HTML/CSS )        |

## Architecture

```
src-tauri/
├── Cargo.toml            ( package = loklm-installer )
├── tauri.conf.json       ( window config , bundle metadata )
├── build.rs              ( tauri-build standard )
├── capabilities/
│   └── default.json      ( Tauri 2.x permission system )
├── icons/                ( multi-resolution , generated via cargo tauri icon )
└── src/
    ├── main.rs           ( entry , registers commands )
    ├── commands.rs       ( #[tauri::command] handlers )
    └── installer.rs      ( port of frontend/ install logic )
```

The frontend ( `./frontend/index.html` + `styles.css` + `renderer.js` +
`i18n.js` ) is shared with the legacy electron build ; `tauri-bridge.js`
shims `window.installer.*` calls to `__TAURI__.core.invoke()`.

## Build

Prereqs ( one-time ) :

- Rust toolchain ( msvc ) via https://rustup.rs/
- MSVC Build Tools 2022 ( Desktop development with C++ workload )
- WebView2 runtime ( already on Win10+ )
- `cargo install tauri-cli --version ^2.0`

```pwsh
cd installer-wizard/src-tauri
cargo tauri build --no-bundle
```

Output : `installer-wizard/src-tauri/target/release/loklm-installer.exe`
( ~2.8 MB stripped )

Or invoke via the project-level pipeline :

```pwsh
pnpm package:win:wizard
```

## Run standalone ( dev )

The wizard expects to find the LokLM payload at `../../release/win-unpacked/`
relative to its own .exe ( dev fallback path in `payload_dir()` ). Build
the payload first via `pnpm package:win:payload` , then run :

```pwsh
.\installer-wizard\src-tauri\target\release\loklm-installer.exe
```

## How it's distributed

`scripts/build-installer-stub.mjs` wraps this exe + the LokLM payload
into a single NSIS-built `LokLM-Setup-<version>-win-x64.exe` that is
what users download. See that script for the bundling architecture.

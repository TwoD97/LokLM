import { describe, it, expect } from 'vitest'
import {
  fileTrack,
  isPathIgnored,
  shouldIndexFile,
  DEFAULT_MAX_INDEX_FILE_BYTES,
} from '@main/services/codebase/ignore'

describe('codebase ignore rules', () => {
  it('ignores vendored/build directories on any segment', () => {
    expect(isPathIgnored('node_modules/react/index.js')).toBe(true)
    expect(isPathIgnored('src/node_modules/x.ts')).toBe(true)
    expect(isPathIgnored('target/debug/app.rs')).toBe(true)
    expect(isPathIgnored('.git/config')).toBe(true)
    expect(isPathIgnored('dist/bundle.js')).toBe(true)
    expect(isPathIgnored('src/index.ts')).toBe(false)
  })

  it('ignores lockfiles, env files, binaries, and minified assets', () => {
    expect(isPathIgnored('pnpm-lock.yaml')).toBe(true)
    expect(isPathIgnored('app/.env.local')).toBe(true)
    expect(isPathIgnored('assets/logo.png')).toBe(true)
    expect(isPathIgnored('lib/native.node'.replace('.node', '.so'))).toBe(true)
    expect(isPathIgnored('public/app.min.js')).toBe(true)
    expect(isPathIgnored('Cargo.lock')).toBe(true)
  })

  it('routes source files to the code track', () => {
    expect(fileTrack('src/index.ts')).toBe('code')
    expect(fileTrack('main.go')).toBe('code')
    expect(fileTrack('app/models.py')).toBe('code')
    expect(fileTrack('config/schema.sql')).toBe('code')
    expect(fileTrack('pkg/config.yaml')).toBe('code')
  })

  it('routes prose files to the doc track', () => {
    expect(fileTrack('README.md')).toBe('doc')
    expect(fileTrack('docs/guide.mdx')).toBe('doc')
    expect(fileTrack('CHANGELOG.rst')).toBe('doc')
    expect(fileTrack('notes.txt')).toBe('doc')
  })

  it('skips ignored, unknown, and oversized files', () => {
    expect(fileTrack('node_modules/x/y.ts')).toBe('skip')
    expect(fileTrack('logo.png')).toBe('skip')
    expect(fileTrack('data.unknownext')).toBe('skip')
    expect(fileTrack('huge.ts', DEFAULT_MAX_INDEX_FILE_BYTES + 1)).toBe('skip')
    expect(fileTrack('ok.ts', DEFAULT_MAX_INDEX_FILE_BYTES)).toBe('code')
  })

  it('shouldIndexFile agrees with fileTrack', () => {
    expect(shouldIndexFile('src/a.ts')).toBe(true)
    expect(shouldIndexFile('README.md')).toBe(true)
    expect(shouldIndexFile('node_modules/a.ts')).toBe(false)
    expect(shouldIndexFile('logo.png')).toBe(false)
  })

  it('normalizes Windows separators', () => {
    expect(isPathIgnored('node_modules\\react\\index.js')).toBe(true)
    expect(fileTrack('src\\app\\main.ts')).toBe('code')
  })
})

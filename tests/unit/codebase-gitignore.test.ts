import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ignore from 'ignore'
import {
  makeGitignoreFilter,
  loadGitignore,
  isGitignored,
  type GitignoreLayer,
} from '@main/services/codebase/gitignore'

const layer = (base: string, patterns: string): GitignoreLayer => ({
  base,
  ig: ignore().add(patterns),
})

describe('gitignore matcher (makeGitignoreFilter)', () => {
  it('ignores directory and glob patterns; keeps source', () => {
    const f = makeGitignoreFilter(['build/', 'dist', '*.log', 'coverage/'].join('\n'))
    expect(f.ignores('build/app.js')).toBe(true)
    expect(f.ignores('build', true)).toBe(true) // dir itself → prune subtree
    expect(f.ignores('dist/bundle.js')).toBe(true)
    expect(f.ignores('app.log')).toBe(true)
    expect(f.ignores('logs/server.log')).toBe(true)
    expect(f.ignores('src/index.ts')).toBe(false)
    expect(f.ignores('README.md')).toBe(false)
  })

  it('honors negation (re-include)', () => {
    const f = makeGitignoreFilter(['*.log', '!keep.log'].join('\n'))
    expect(f.ignores('debug.log')).toBe(true)
    expect(f.ignores('keep.log')).toBe(false)
  })

  it('ignores comments and blank lines', () => {
    const f = makeGitignoreFilter(['# a comment', '', '   ', 'secret.txt'].join('\n'))
    expect(f.ignores('secret.txt')).toBe(true)
    expect(f.ignores('a.txt')).toBe(false)
  })

  it('handles anchored patterns and backslash paths', () => {
    const f = makeGitignoreFilter('/root-only.txt')
    expect(f.ignores('root-only.txt')).toBe(true)
    expect(f.ignores('sub/root-only.txt')).toBe(false)
    // backslash input (Windows) is normalised to forward slashes
    expect(f.ignores('build\\app.js'.replace('build', 'x'))).toBe(false)
    expect(makeGitignoreFilter('build/').ignores('build\\app.js')).toBe(true)
  })

  it('never ignores the empty/root path', () => {
    const f = makeGitignoreFilter('*')
    expect(f.ignores('')).toBe(false)
    expect(f.ignores('.')).toBe(false)
  })
})

describe('nested gitignore precedence (isGitignored)', () => {
  const root = layer('', '*.log\nbuild/')

  it('root layer matches at any depth', () => {
    expect(isGitignored([root], 'app.log')).toBe(true)
    expect(isGitignored([root], 'pkg/sub/x.log')).toBe(true)
    expect(isGitignored([root], 'build/out.js')).toBe(true)
    expect(isGitignored([root], 'src/index.ts')).toBe(false)
  })

  it('a deeper layer re-includes (negation) over a shallower exclude', () => {
    const layers = [root, layer('pkg', '!important.log')]
    expect(isGitignored(layers, 'pkg/important.log')).toBe(false) // re-included by pkg/.gitignore
    expect(isGitignored(layers, 'pkg/nested/important.log')).toBe(false) // non-anchored negation
    expect(isGitignored(layers, 'app.log')).toBe(true) // outside pkg → still ignored
    expect(isGitignored(layers, 'pkg/other.log')).toBe(true) // still matched by root *.log
  })

  it('a deeper layer adds its own excludes, scoped to its subtree', () => {
    const layers = [root, layer('pkg', 'secret.ts')]
    expect(isGitignored(layers, 'pkg/secret.ts')).toBe(true) // excluded by pkg/.gitignore
    expect(isGitignored(layers, 'secret.ts')).toBe(false) // root-level not in pkg scope
    expect(isGitignored(layers, 'pkg/keep.ts')).toBe(false)
  })

  it('directories test with a trailing slash so dir-only patterns prune', () => {
    expect(isGitignored([root], 'build', true)).toBe(true)
    expect(isGitignored([root], 'src', true)).toBe(false)
  })
})

describe('loadGitignore (filesystem)', () => {
  it('returns null when the folder has no .gitignore', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gi-none-'))
    try {
      expect(await loadGitignore(dir)).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('loads .gitignore and folds in .git/info/exclude', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gi-some-'))
    try {
      await writeFile(join(dir, '.gitignore'), 'dist/\n')
      await mkdir(join(dir, '.git', 'info'), { recursive: true })
      await writeFile(join(dir, '.git', 'info', 'exclude'), '*.tmp\n')
      const f = await loadGitignore(dir)
      expect(f).not.toBeNull()
      expect(f!.ignores('dist/x.js')).toBe(true)
      expect(f!.ignores('scratch.tmp')).toBe(true)
      expect(f!.ignores('src/a.ts')).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeGitignoreFilter, loadGitignore } from '@main/services/codebase/gitignore'

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

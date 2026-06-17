import { describe, it, expect } from 'vitest'
import { classifyCodebase } from '@main/services/codebase/classify'

describe('classifyCodebase', () => {
  it('classifies a Node/TS project via marker files', () => {
    const c = classifyCodebase([
      'package.json',
      'tsconfig.json',
      'src/index.ts',
      'src/util.ts',
      'README.md',
    ])
    expect(c.isCodebase).toBe(true)
    expect(c.ecosystems).toContain('node')
    expect(c.primaryLanguage).toBe('TypeScript')
    expect(c.markers).toContain('package.json')
  })

  it('classifies a Rust project and reports the ecosystem', () => {
    const c = classifyCodebase(['Cargo.toml', 'src/main.rs', 'src/lib.rs'])
    expect(c.isCodebase).toBe(true)
    expect(c.ecosystems).toEqual(['rust'])
    expect(c.primaryLanguage).toBe('Rust')
  })

  it('detects dotnet via .csproj extension marker', () => {
    const c = classifyCodebase(['App/App.csproj', 'App/Program.cs'])
    expect(c.isCodebase).toBe(true)
    expect(c.ecosystems).toContain('dotnet')
    expect(c.primaryLanguage).toBe('C#')
  })

  it('does NOT classify a docs folder as a codebase', () => {
    const c = classifyCodebase(['notes.md', 'report.pdf', 'ideas.txt', 'todo.md'])
    expect(c.isCodebase).toBe(false)
    expect(c.primaryLanguage).toBeNull()
    expect(c.ecosystems).toEqual([])
  })

  it('classifies a marker-less folder when code dominates', () => {
    const paths = Array.from({ length: 8 }, (_, i) => `scripts/s${i}.py`)
    const c = classifyCodebase([...paths, 'notes.md'])
    expect(c.isCodebase).toBe(true)
    expect(c.primaryLanguage).toBe('Python')
    expect(c.codeFileRatio).toBeGreaterThan(0.5)
  })

  it('stays a non-codebase when one stray script sits among many docs', () => {
    const docs = Array.from({ length: 20 }, (_, i) => `d${i}.md`)
    const c = classifyCodebase([...docs, 'build.py'])
    expect(c.isCodebase).toBe(false)
  })

  it('ranks languages by file count', () => {
    const c = classifyCodebase(['package.json', 'a.ts', 'b.ts', 'c.ts', 'd.py'])
    expect(c.languages[0]).toEqual({ language: 'TypeScript', files: 3 })
    expect(c.languages[1]).toEqual({ language: 'Python', files: 1 })
  })

  it('handles an empty folder', () => {
    const c = classifyCodebase([])
    expect(c.isCodebase).toBe(false)
    expect(c.codeFileRatio).toBe(0)
  })
})

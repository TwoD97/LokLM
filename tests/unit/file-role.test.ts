import { describe, it, expect } from 'vitest'
import { fileRole, isSecondaryCodeRole } from '@main/services/codebase/fileRole'

describe('fileRole', () => {
  it('classifies application source', () => {
    expect(fileRole('src/main/services/auth/AuthService.ts')).toBe('source')
    expect(fileRole('src/renderer/src/chat/ChatView.tsx')).toBe('source')
  })

  it('classifies tests by path AND by filename marker', () => {
    expect(fileRole('tests/unit/heuristics.test.ts')).toBe('test')
    expect(fileRole('tests/integration/qa-answer.test.ts')).toBe('test')
    // co-located unit test next to source — filename marker, not path
    expect(fileRole('src/shared/authHelpers.smoke.test.ts')).toBe('test')
    expect(fileRole('src/renderer/src/quiz/QuizListView.test.tsx')).toBe('test')
    // other ecosystems
    expect(fileRole('pkg/foo_test.go')).toBe('test')
    expect(fileRole('app/models/user_spec.rb')).toBe('test')
    expect(fileRole('src/utils/conftest.py')).toBe('test')
  })

  it('classifies evals + benchmarks distinctly from tests', () => {
    expect(fileRole('tests/evals/code/run.ts')).toBe('eval')
    expect(fileRole('tests/bench/vulkan-embed-batch.ts')).toBe('eval')
  })

  it('classifies config, generated, and examples', () => {
    expect(fileRole('tsconfig.json')).toBe('config')
    expect(fileRole('electron.vite.config.ts')).toBe('config')
    expect(fileRole('package.json')).toBe('config')
    expect(fileRole('src/shared/types.d.ts')).toBe('generated')
    expect(fileRole('src/api/schema.generated.ts')).toBe('generated')
    expect(fileRole('examples/demo.ts')).toBe('example')
  })

  it('prose is doc wherever it lives — even under tests/ (pitfall)', () => {
    expect(fileRole('README.md')).toBe('doc')
    expect(fileRole('docs/project-handbook/STYLE_GUIDE.md')).toBe('doc')
    expect(fileRole('tests/manual/checklist.md')).toBe('doc') // path-test loses to doc-by-extension
  })

  it('ignores non-indexable files', () => {
    expect(fileRole('node_modules/lib/index.ts')).toBe('skip')
    expect(fileRole('assets/logo.png')).toBe('skip')
    expect(fileRole('dist/main.js')).toBe('skip')
  })

  it('isSecondaryCodeRole marks everything but source/doc as below-implementation', () => {
    expect(isSecondaryCodeRole('source')).toBe(false)
    expect(isSecondaryCodeRole('doc')).toBe(false)
    expect(isSecondaryCodeRole('test')).toBe(true)
    expect(isSecondaryCodeRole('eval')).toBe(true)
    expect(isSecondaryCodeRole('example')).toBe(true)
    expect(isSecondaryCodeRole('config')).toBe(true)
    expect(isSecondaryCodeRole('generated')).toBe(true)
  })
})

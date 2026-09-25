import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type UserSettings } from '../../src/shared/settings'
import { runtimeSettingsChanged } from '@main/services/settings/runtimeSettings'
import {
  applyLeanRetrievalDefaults,
  needsLeanRetrieval,
} from '@main/services/retrieval/hardwareDefaults'
import { assessRerankerPolicy } from '../../src/shared/modelCapabilities'
import type { AnswerOptions } from '../../src/shared/documents'

describe('settings runtime boundary', () => {
  it.each<[string, (settings: UserSettings) => void]>([
    [
      'theme',
      (s) => {
        s.basic.theme = 'dark'
      },
    ],
    [
      'module visibility',
      (s) => {
        s.basic.modules.quiz = false
      },
    ],
    [
      'start view',
      (s) => {
        s.basic.startView = 'notes'
      },
    ],
    [
      'calendar week',
      (s) => {
        s.basic.weekStartsOn = 0
      },
    ],
    [
      'pipeline display',
      (s) => {
        s.basic.showPipelineSteps = !s.basic.showPipelineSteps
      },
    ],
    [
      'retrieval count',
      (s) => {
        s.retrieval.topK += 1
      },
    ],
  ])('%s changes do not reconfigure models', (_label, update) => {
    const next = structuredClone(DEFAULT_SETTINGS)
    update(next)
    expect(runtimeSettingsChanged(DEFAULT_SETTINGS, next)).toBe(false)
  })

  it.each<[string, (settings: UserSettings) => void]>([
    [
      'interface language',
      (s) => {
        s.basic.language = s.basic.language === 'de' ? 'en' : 'de'
      },
    ],
    [
      'answer language',
      (s) => {
        s.basic.answerLanguage = 'de'
      },
    ],
    [
      'chat model',
      (s) => {
        s.basic.llmProfile = 'xl'
      },
    ],
    [
      'GPU policy',
      (s) => {
        s.advanced.reranker.policy = 'always'
      },
    ],
    [
      'provider',
      (s) => {
        s.advanced.llm.source = 'ollama'
      },
    ],
    [
      'auto lock',
      (s) => {
        s.security.autoLockMinutes += 1
      },
    ],
  ])('%s changes reach the live runtime', (_label, update) => {
    const next = structuredClone(DEFAULT_SETTINGS)
    update(next)
    expect(runtimeSettingsChanged(DEFAULT_SETTINGS, next)).toBe(true)
  })

  it('ignores structurally equal settings received as a fresh object', () => {
    expect(runtimeSettingsChanged(DEFAULT_SETTINGS, structuredClone(DEFAULT_SETTINGS))).toBe(false)
  })
})

describe('hardware-aware retrieval defaults', () => {
  it('includes a Standard/dev 4 GB-class GPU, and excludes a configured external LLM', () => {
    const rerankerDecision = assessRerankerPolicy({
      enabled: true,
      mode: 'auto',
      source: 'bundled',
      resources: { hasGpu: true, totalVramGB: 4.1 },
    })
    expect(needsLeanRetrieval({ tier: 'standard', llmSource: 'bundled', rerankerDecision })).toBe(
      true,
    )
    expect(needsLeanRetrieval({ tier: null, llmSource: 'bundled', totalVramGB: 4.1 })).toBe(true)
    expect(needsLeanRetrieval({ tier: 'standard', llmSource: 'bundled', totalVramGB: 12 })).toBe(
      false,
    )
    expect(needsLeanRetrieval({ tier: 'lite', llmSource: 'bundled' })).toBe(true)
    expect(needsLeanRetrieval({ tier: 'lite', llmSource: 'ollama', rerankerDecision })).toBe(false)
  })

  it('sets cheaper defaults while retaining every explicit retrieval control', () => {
    const defaults: AnswerOptions = { topK: 8 }
    applyLeanRetrievalDefaults(defaults)
    expect(defaults).toEqual({
      topK: 8,
      multiQuery: false,
      contextualizeHeuristicOnly: true,
      wholeDocFallback: false,
      cpuOptimized: true,
    })
    const explicit: AnswerOptions = {
      multiQuery: true,
      contextualizeHeuristicOnly: false,
      wholeDocFallback: true,
      cpuOptimized: false,
      rerank: true,
    }
    const previous = { ...explicit }
    applyLeanRetrievalDefaults(explicit)
    expect(explicit).toEqual(previous)
  })
})

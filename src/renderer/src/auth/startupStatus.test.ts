import { describe, expect, it } from 'vitest'
import { startupPresentation, type StartupModel } from './startupStatus'

const ready: StartupModel = { state: 'ready', source: 'bundled', loadProgress: null }

describe('startup presentation consistency', () => {
  it('requires explicit residency to claim a local model is ready', () => {
    expect(startupPresentation(ready).state).toBe('onDemand')
    expect(startupPresentation({ ...ready, resident: false }).state).toBe('onDemand')
    expect(startupPresentation({ ...ready, resident: true }).state).toBe('ready')
    expect(startupPresentation({ ...ready, state: 'unloaded' }).state).toBe('notLoaded')
  })

  it('does not turn configured external services into a verified-ready promise', () => {
    expect(startupPresentation({ ...ready, source: 'ollama' })).toMatchObject({
      state: 'external',
      hint: 'startup.externalHint',
    })
    expect(startupPresentation({ ...ready, source: 'ollama', state: 'failed' }).state).toBe(
      'unavailable',
    )
    expect(
      startupPresentation({
        ...ready,
        source: 'ollama',
        resident: false,
        fallback: { active: true, reason: 'Disconnected' },
      }).state,
    ).toBe('onDemand')
  })

  it('keeps optional policy decisions separate from loading errors', () => {
    const policy = {
      mode: 'auto' as const,
      source: 'bundled' as const,
      allowed: false,
      totalVramGB: 4.1,
    }
    expect(
      startupPresentation({ ...ready, policyDecision: { ...policy, reason: 'low-vram' } }).state,
    ).toBe('offAuto')
    expect(
      startupPresentation({ ...ready, policyDecision: { ...policy, reason: 'unknown-vram' } }),
    ).toMatchObject({ state: 'offAuto', hint: 'startup.unknownMemoryHint' })
    expect(
      startupPresentation({ ...ready, policyDecision: { ...policy, reason: 'gpu-unavailable' } })
        .state,
    ).toBe('unavailable')
    expect(
      startupPresentation({ ...ready, policyDecision: { ...policy, reason: 'low-vram' } }, false)
        .state,
    ).toBe('off')
  })
})

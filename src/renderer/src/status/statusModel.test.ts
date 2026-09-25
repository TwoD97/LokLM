import { describe, expect, it } from 'vitest'
import { assessRerankerPolicy } from '@shared/modelCapabilities'
import { modelState, refinementState, runtimeModel, UNKNOWN_MODEL } from './statusModel'

describe('capability availability', () => {
  it('never calls parked, unverified or unloaded local models ready', () => {
    expect(modelState(UNKNOWN_MODEL)).toBe('checking')
    expect(modelState({ ...UNKNOWN_MODEL, state: 'ready', resident: false })).toBe('standby')
    expect(modelState({ ...UNKNOWN_MODEL, state: 'ready' })).toBe('standby')
    expect(modelState({ ...UNKNOWN_MODEL, state: 'unloaded', resident: false })).toBe('unloaded')
    expect(modelState({ ...UNKNOWN_MODEL, state: 'ready', resident: true })).toBe('ready')
  })

  it('distinguishes external service readiness from local fallback', async () => {
    const base = await window.api.llm.status()
    const external = { ...base, source: 'ollama' as const, state: 'ready' as const, resident: true }
    expect(modelState(runtimeModel(external))).toBe('remote')
    expect(
      modelState(runtimeModel({ ...external, fallback: { active: true, reason: 'Disconnected' } })),
    ).toBe('ready')
  })

  it.each([
    ['low-vram', false, 'skipped'],
    ['unknown-vram', false, 'unknown'],
    ['gpu-unavailable', false, 'failed'],
    ['disabled', false, 'off'],
    ['external', true, 'remote'],
    ['manual', true, 'standby'],
  ] as const)(
    'uses the machine-readable %s policy rather than English diagnostics',
    (reason, allowed, expected) => {
      expect(
        refinementState(
          {
            ...UNKNOWN_MODEL,
            state: 'ready',
            resident: false,
            source: reason === 'external' ? 'ollama' : 'bundled',
            message: 'An arbitrary localized diagnostic',
            policyDecision: {
              reason,
              allowed,
              source: reason === 'external' ? 'ollama' : 'bundled',
              totalVramGB: 4.1,
              mode: 'auto',
            },
          },
          true,
        ),
      ).toBe(expected)
    },
  )

  it('honors explicit Off even if a previous policy allowed loading', () => {
    expect(
      refinementState(
        {
          ...UNKNOWN_MODEL,
          state: 'ready',
          resident: true,
          policyDecision: assessRerankerPolicy({
            enabled: true,
            mode: 'always',
            source: 'bundled',
            resources: { hasGpu: true, totalVramGB: 4.1 },
          }),
        },
        false,
      ),
    ).toBe('off')
  })
})

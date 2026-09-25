import type { ModelStatus, RerankerStatus } from '@shared/documents'

export type StartupModel = Pick<ModelStatus, 'state' | 'source' | 'loadProgress' | 'resident'> &
  Pick<RerankerStatus, 'policyDecision'> &
  Partial<Pick<ModelStatus, 'fallback'>>
export interface StartupPresentation {
  state:
    | 'checking'
    | 'waiting'
    | 'loading'
    | 'ready'
    | 'onDemand'
    | 'unavailable'
    | 'notLoaded'
    | 'offAuto'
    | 'off'
    | 'external'
  hint: string | null
  progress: number | null
}

/** Display capability and placement separately; optional policy is never an error. */
export function startupPresentation(
  status: StartupModel | null,
  enabled = true,
): StartupPresentation {
  const result = (
    state: StartupPresentation['state'],
    hint: string | null = null,
    progress: number | null = null,
  ): StartupPresentation => ({ state, hint, progress })
  if (!enabled || status?.policyDecision?.reason === 'disabled')
    return result('off', 'startup.offHint')
  switch (status?.policyDecision?.reason) {
    case 'low-vram':
      return result('offAuto', 'startup.lowMemoryHint')
    case 'unknown-vram':
      return result('offAuto', 'startup.unknownMemoryHint')
    case 'gpu-unavailable':
      return result('unavailable', 'startup.noGpuHint')
  }
  if (!status) return result('checking')
  if (status.state === 'failed') return result('unavailable', 'startup.failedHint')
  if (status.source === 'ollama' && !status.fallback?.active)
    return result('external', 'startup.externalHint')
  if (status.state === 'loading') {
    const value = status.loadProgress
    return result(
      'loading',
      'startup.loadingHint',
      value != null && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null,
    )
  }
  if (status.state === 'ready')
    return status.resident === true ? result('ready') : result('onDemand', 'startup.onDemandHint')
  if (status.state === 'unloaded') return result('notLoaded', 'startup.notLoadedHint')
  return result('waiting')
}

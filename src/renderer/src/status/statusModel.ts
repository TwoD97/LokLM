import type { ModelState, EmbedderStatus, ModelStatus, RerankerStatus } from '@shared/documents'
import type { RerankerDecision } from '@shared/modelCapabilities'

export type CapabilityState =
  | 'ready'
  | 'remote'
  | 'standby'
  | 'unloaded'
  | 'loading'
  | 'working'
  | 'waiting'
  | 'failed'
  | 'off'
  | 'skipped'
  | 'missing'
  | 'checking'
  | 'unknown'
export interface RuntimeModel {
  state: ModelState | null
  resident: boolean | null
  source: 'bundled' | 'ollama'
  modelName: string | null
  message: string | null
  progress: number | null
  policyDecision?: RerankerDecision | undefined
}
export const UNKNOWN_MODEL: RuntimeModel = {
  state: null,
  resident: null,
  source: 'bundled',
  modelName: null,
  message: null,
  progress: null,
}

export function runtimeModel(status: ModelStatus | EmbedderStatus | RerankerStatus): RuntimeModel {
  return {
    state: status.state,
    resident: status.resident ?? null,
    source: 'fallback' in status && status.fallback.active ? 'bundled' : status.source,
    modelName: status.modelName,
    message: status.message,
    progress: status.loadProgress == null ? null : Math.round(status.loadProgress * 100),
    ...('policyDecision' in status ? { policyDecision: status.policyDecision } : {}),
  }
}

export function modelState(model: RuntimeModel): CapabilityState {
  if (model.state === null) return 'checking'
  if (model.state === 'failed') return 'failed'
  if (model.state === 'loading') return 'loading'
  if (model.state === 'ready') {
    if (model.source === 'ollama') return 'remote'
    return model.resident === true ? 'ready' : 'standby'
  }
  return 'unloaded'
}

export function refinementState(model: RuntimeModel, enabled: boolean): CapabilityState {
  if (!enabled || model.policyDecision?.reason === 'disabled') return 'off'
  if (model.policyDecision?.reason === 'low-vram') return 'skipped'
  if (model.policyDecision?.reason === 'unknown-vram') return 'unknown'
  if (model.policyDecision?.reason === 'gpu-unavailable') return 'failed'
  return modelState(model)
}

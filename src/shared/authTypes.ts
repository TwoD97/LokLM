import type { WordlistLang } from './authHelpers'

export type AuthStatus = {
  registered: boolean
  locked: boolean
  displayName: string | null
  remainingRecoveryCodes: number
  recoveryLang: WordlistLang | null
}

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'no_user' | 'bad_password' | 'rate_limited'; retryAfterMs?: number }

export type RegisterResult = { passphrase: string[] }

export type ResetResult =
  | { ok: true; passphrase: string[] }
  | { ok: false; reason: 'no_user' | 'bad_code' | 'rate_limited'; retryAfterMs?: number }

/**
 * Stages emitted during `auth:login`. Ordered , `deriving` → `decrypting` →
 * `restoring`. `ready` fires once the in-memory DB is up. The renderer maps
 * these to localised labels in the LoginView spinner so a slow argon2 / large
 * vault no longer looks like a frozen UI.
 *
 * Stages are diagnostic only , losing one (e.g. a renderer that subscribes
 * mid-flight) is fine ; the final `auth:login` IPC return is still authoritative
 * for success/failure.
 */
export type AuthLoginStage = 'deriving' | 'decrypting' | 'restoring' | 'ready'

export type AuthLoginProgressEvent = {
  stage: AuthLoginStage
}

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

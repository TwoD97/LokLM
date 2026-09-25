import { isDeepStrictEqual } from 'node:util'
import type { UserSettings } from '../../../shared/settings'

/** Presentation and per-request retrieval settings must not reinitialise engines. */
export function runtimeSettingsChanged(before: UserSettings, after: UserSettings): boolean {
  return (
    before.basic.llmProfile !== after.basic.llmProfile ||
    before.basic.language !== after.basic.language ||
    before.basic.answerLanguage !== after.basic.answerLanguage ||
    before.security.autoLockMinutes !== after.security.autoLockMinutes ||
    !isDeepStrictEqual(before.advanced, after.advanced)
  )
}

# Personal workflow review — 24 September 2026

## Scope

This review covers the local Calendar, Notes and To-dos workflows and the personal/settings surfaces. It targets lost drafts, misleading save or loading states, keyboard access, and recoverable failures. It preserves explicit save actions, encrypted local storage, and the current feature scope: no account synchronization, reminders, recurring events, or implied background notification delivery.

Reviewed paths:

- `src/renderer/src/organizer/`: `OrganizerView`, `NotesView`, `TodosView`, `CalendarView`, `OrganizerShared`, `useOrganizer`, `useOrganizerActions`, and `organizerDates`.
- `src/renderer/src/settings/`: `ModulesTab`, `moduleOptions`, `BasicTab`, `AdvancedTab`, `ProfileTab`, `OllamaSection`, `RecoveryCodesModal`, `ReindexGateModal`, `Segmented`, and every advanced section under `sections/`.
- `src/renderer/src/i18n/dict_organizer.ts` and `dict_settings.ts`; direct UTF-8 replacement-character/question-mark scan across source TypeScript, TSX, CSS, and HTML.
- Save/migration contracts in `src/shared/organizer.ts`, `src/main/services/organizer/OrganizerService.ts`, `src/main/services/settings/SettingsService.ts`, and the durable KV transaction in `src/main/services/auth/AuthService.ts`.
- `AppShell`, `useSettings`, `SettingsModal`, and `SystemTab` were checked for integration context; the parallel application/status review owns their changes.

## Findings and changes

| Trigger                                                                 | Previous behavior                                               | Result                                                                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Organizer cannot initially load                                         | Error claimed a draft was kept even though no editor had loaded | Load-specific message and retry; save failures continue to explain draft retention                                                |
| Create a task while viewing Completed                                   | Successfully saved task disappeared into the Open filter        | Successful creation reveals Open tasks, announces the result, and restores quick-add focus                                        |
| Change task filters or complete an item while its title is being edited | Dirty edit could disappear with its row                         | Confirm discard before hiding the editor; cancellation keeps the text and performs no mutation                                    |
| Save, cancel, or delete a calendar event                                | Focused editor/control disappeared                              | Focus returns to Add event; invalid start and end times reference the validation message                                          |
| Change advanced preferences and persistence fails                       | Several event handlers left rejected promises unhandled         | Shared save helper catches failures and shows an inline message; no false success indication                                      |
| Change GPU placement but preference write fails                         | Reload could continue after the failed preference write         | Reload starts only after a committed preference; reload failures have a separate retry message                                    |
| Account profile or avatar load/save fails                               | Missing feedback and unhandled avatar-removal rejection         | Retry on profile load; pending controls and inline save errors; failed avatar removal retains the existing image                  |
| Change account password using keyboard                                  | Placeholder-only fields and no normal form submission           | Visible labels, suitable autocomplete values, native form submit, duplicate-submit prevention, and retained input after rejection |
| Regenerate recovery codes then press Escape or click away while waiting | One-time replacement codes could arrive after dismissal         | Pending regeneration cannot dismiss or duplicate; named dialog/focus containment; revealed codes receive focus                    |
| Use nested re-index confirmation                                        | Escape could escape into the enclosing settings dialog          | Named focus-contained dialog handles Escape itself; pending confirmation cannot be dismissed                                      |
| Navigate advanced accordions/subtabs/segmented choices by keyboard      | Click-only headers and radio semantics without arrow behavior   | Native header buttons, stable named panels, roving tab stops, arrows/Home/End, and disabled-option skipping                       |
| Ollama connection probe rejects or an old response arrives late         | Could remain checking indefinitely or replace a newer result    | Rejection message with retry; request versioning rejects stale replies; checks use committed connection values                    |
| Read Translation status and IPC rejects                                 | Indefinite Loading label                                        | Error and retry; later live status wins over an older initial query                                                               |
| Select the bundled embedder in Standard/Pro                             | Label and re-index confirmation always claimed BGE-M3           | Local-provider label avoids inventing a model identity; the manifest also ships Qwen3 Embedding                                   |
| Open reranker controls in Advanced                                      | Behavior differed from the System policy selection              | Auto/Always/Off uses the same persisted fields and backend policy decision, including low-VRAM and unknown-capacity explanations  |

Basic settings now announces Saved only after a completed save, rather than leaving an opacity-hidden success message in the accessibility tree.

## Existing behavior checked

- Notes create/edit/save with Ctrl+S, guarded note selection, confirmed delete, failed-save retry without duplicate writes, and conflict refresh preserving the local draft.
- Note draft retention across organizer and other module navigation. These are in-memory unsaved drafts, not a promise of recovery after process exit or locking.
- Task due-date edit, completion/reopening, filters, confirmed delete, and due-date display in Calendar.
- Calendar local-date handling, keyboard day navigation, dirty date-change guard, required dates, same-day time ordering, and all-day input validation. No UTC conversion is used for local calendar dates.
- Modules hide/show preferences, saved start view, week-start choice, failed preference rollback, and safe Library fallback when a selected/active module is hidden. Library and Chat remain core navigation.
- Settings migration fills newly introduced module/calendar/policy keys without discarding existing choices. Concurrent patches merge against the last committed state.
- Organizer and preference updates wait for encrypted-vault persistence before announcing success. Pending candidate KV data cannot leak into another snapshot; failed writes do not advance revisions, update the settings cache, or notify success. Locked/stale service instances reject mutations.

## Encoding check

The direct UTF-8 scan initially found literal question marks replacing German letters in `dict_preferences.ts`: `ausgew?hlter` and `Kapazit?t`. This was reported to the owning application agent and is corrected in the current tree. The final scan finds no such text corruption and no U+FFFD replacement characters; remaining question-mark matches are valid regex quantifiers or `?url` imports. Garbled PowerShell display output was not treated as evidence that source text needed replacement.

## Verification

- `pnpm.cmd exec vitest run --project web src/renderer/src/organizer src/renderer/src/settings`: **55 passed across 11 test files**. Includes initial-load retry, Completed-filter creation, dirty-task guards, failed avatar/password/preference mutations, recovery-code dismissal protection, stale/rejected Ollama probes, Translation-status retry, keyboard navigation, organizer CRUD/conflicts, and module/start-view behavior.
- `pnpm.cmd exec tsc -p tsconfig.web.json --pretty false`: passed.
- Targeted ESLint over the reviewed organizer/settings implementations, tests, and modified dictionaries: passed without warnings.
- Earlier backend verification in this task covered organizer persistence/concurrency/validation, settings migration/failure isolation, and real encrypted-vault save/lock/reopen. The actual vault roundtrip also checked that note text was absent from the encrypted file in plaintext.

Renderer tests use the mocked Electron API. Integrated application screenshots, startup/hardware transitions, and the native development smoke test are owned by the parallel application review. This review does not claim a human usability study or operating-system screen-reader test.

## Authentication follow-up

Reviewed `auth/PassphraseReveal.tsx`, `LoginView.tsx`, `ResetView.tsx`, `RegisterView.tsx`, and the related `dict_auth.ts` copy.

- Recovery-word copying previously swallowed clipboard rejection. It now shows a localized error and a retry action while leaving all words visible. A pending copy cannot be duplicated, and Next stays disabled until the request settles. The temporary success-message timer is cleared on unmount; a late IPC response does not update a dismissed view.
- Forgot password and the password input remained enabled during unlock. Both now stay disabled until the attempt finishes, so login cannot switch into recovery mid-request. A failed attempt restores the controls and preserves the entered password.
- Reset Cancel was also unguarded. Cancel and all reset inputs now stay disabled during the request, protecting the transition to newly generated recovery words. Registration fields and the recovery-language fieldset follow the same pending-state rule.

`AuthTransitions.test.tsx` adds three regression scenarios: failed-copy retry/deduplication/timer cleanup; pending unlock navigation with rejected-attempt recovery; and pending reset navigation. Together with `RecoveryCodesModal.test.tsx`, **7 tests pass**. Targeted auth ESLint and the renderer typecheck pass.

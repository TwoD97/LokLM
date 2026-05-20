/**
 * FirstRunWizard — gezeigt nach der allerersten Installation, bevor der
 * User registriert wird. Übernimmt die Rolle der alten Setup-Seiten mit
 * vollem App-Design (Inter, BG-Blobs, Glasmorphismus).
 *
 * Schritte:
 *   1. Welcome       — Begrüßung + kurze Erklärung
 *   2. License       — MIT-Text zum Lesen + "Ich stimme zu" Toggle
 *   3. Options       — Shortcuts + Autostart Toggles
 *   4. Models        — Required GGUF-Models herunterladen (wraps ModelDownloadView)
 *   5. Finish        — "LokLM ist bereit", weiter zum Register-Flow
 *
 * Auslöser:
 *   - App-Start nach Installation: `setup.firstRunDone === false` triggert das Render in App.tsx.
 *
 * Persistenz:
 *   - Options-Step schreibt nach HKCU\Software\LokLM\Setup über einen IPC-Call
 *     (siehe `window.api.setup.saveOptions` — to be wired by Denys).
 *   - "Done"-Marker wird nach dem Finish-Step gesetzt (`window.api.setup.markFirstRunDone`).
 */

import { useCallback, useState } from 'react'
import type { SetupOptions } from '@shared/setupTypes'
import { WelcomeStep } from './WelcomeStep'
import { LicenseStep } from './LicenseStep'
import { OptionsStep } from './OptionsStep'
import { ModelsStep } from './ModelsStep'
import { FinishStep } from './FinishStep'
import './firstrun.css'

type StepKey = 'welcome' | 'license' | 'options' | 'models' | 'finish'

const STEPS: ReadonlyArray<{ key: StepKey; label: string }> = [
  { key: 'welcome', label: 'Willkommen' },
  { key: 'license', label: 'Lizenz' },
  { key: 'options', label: 'Optionen' },
  { key: 'models', label: 'Modelle' },
  { key: 'finish', label: 'Bereit' },
]

export type FirstRunOptions = SetupOptions

const DEFAULT_OPTIONS: FirstRunOptions = {
  createDesktopShortcut: true,
  createStartMenuShortcut: true,
  enableAutostart: false,
}

type Props = {
  onComplete: () => void
}

export function FirstRunWizard({ onComplete }: Props): JSX.Element {
  const [stepIndex, setStepIndex] = useState(0)
  const [licenseAccepted, setLicenseAccepted] = useState(false)
  const [modelsReady, setModelsReady] = useState(false)
  const [options, setOptions] = useState<FirstRunOptions>(DEFAULT_OPTIONS)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const step = STEPS[stepIndex] ?? STEPS[0]!
  const isFirst = stepIndex === 0
  const isLast = stepIndex === STEPS.length - 1

  const goNext = useCallback(() => {
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  }, [])

  const goBack = useCallback(() => {
    setStepIndex((i) => Math.max(i - 1, 0))
  }, [])

  const handleModelsReady = useCallback(() => {
    setModelsReady(true)
    goNext()
  }, [goNext])

  const handleFinish = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await window.api.setup.saveOptions(options)
      await window.api.setup.markFirstRunDone()
      onComplete()
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [onComplete, options])

  // Each step controls its own "can we proceed" gate via the disabled prop on the
  // Next button. Welcome + Finish are always proceedable; License needs the
  // acceptance toggle; Options is always OK; Models gates itself internally.
  const canProceed =
    step.key === 'license' ? licenseAccepted : step.key === 'models' ? modelsReady : true

  return (
    <section className="firstrun-card auth-card auth-card--steps auth-card--wide">
      <StepIndicator steps={STEPS} currentIndex={stepIndex} />

      <div className="firstrun-step">
        {step.key === 'welcome' && <WelcomeStep />}
        {step.key === 'license' && (
          <LicenseStep accepted={licenseAccepted} onAcceptedChange={setLicenseAccepted} />
        )}
        {step.key === 'options' && <OptionsStep options={options} onChange={setOptions} />}
        {step.key === 'models' && <ModelsStep onReady={handleModelsReady} />}
        {step.key === 'finish' && <FinishStep options={options} />}
      </div>

      <footer className="firstrun-footer">
        {!isFirst && (
          <button type="button" className="firstrun-btn firstrun-btn--secondary" onClick={goBack}>
            Zurück
          </button>
        )}
        <div className="firstrun-footer__spacer" />
        {!isLast ? (
          <button
            type="button"
            className="firstrun-btn firstrun-btn--primary"
            onClick={goNext}
            disabled={!canProceed}
          >
            Weiter
          </button>
        ) : (
          <button
            type="button"
            className="firstrun-btn firstrun-btn--primary"
            onClick={handleFinish}
            disabled={saving}
          >
            {saving ? 'Speichern ...' : 'Loslegen'}
          </button>
        )}
      </footer>
      {saveError && <p className="auth-card__error">{saveError}</p>}
    </section>
  )
}

function StepIndicator({
  steps,
  currentIndex,
}: {
  steps: ReadonlyArray<{ key: StepKey; label: string }>
  currentIndex: number
}): JSX.Element {
  return (
    <ol className="firstrun-steps" aria-label="Setup-Fortschritt">
      {steps.map((s, i) => {
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending'
        return (
          <li key={s.key} className={`firstrun-step-dot firstrun-step-dot--${state}`}>
            <span className="firstrun-step-dot__num">{i + 1}</span>
            <span className="firstrun-step-dot__label">{s.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

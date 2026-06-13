import { useState } from 'react'
import { ArrowRight, Copy, Check } from 'lucide-react'
import { WRITING_MODES, type WriteResult, type WritingMode } from '@shared/writing'
import { useT, type TFn } from '../i18n'
import './writing.css'

// Standalone writing-assistant page (the DeepL Write analogue). Pick a mode ,
// paste text , get a rewrite in the SAME language on the bundled LLM. No model
// download — it reuses the chat model , so readiness is whatever the LLM
// TitleBar dot shows; a cold model surfaces as a 'model_not_ready' error and
// the handler kicks off a load , so a second click succeeds.

// Map an IPC rejection to a user message. Electron wraps the thrown error
// ("Error invoking remote method 'writing:improve': Error: <code>: <msg>") so
// we match the WritingError code ANYWHERE in the string , not just at the
// front. Anything unrecognised (a genuine model fault , or "No handler
// registered" when the main process is stale after a change) shows its real
// text rather than a canned line — opaque "try again" was the bug that hid
// exactly this.
function writeErrorText(t: TFn, raw: string): string {
  if (raw.includes('model_not_ready')) return t('writing.errorModelLoading')
  if (raw.includes('too_long')) return t('writing.errorTooLong')
  if (raw.includes('empty')) return t('writing.errorEmpty')
  const detail = raw.replace(/^Error invoking remote method '[^']*':\s*/i, '').trim()
  return `${t('writing.errorGeneric')} (${detail})`
}

export function WritingView(): JSX.Element {
  const t = useT()
  const [mode, setMode] = useState<WritingMode>('improve')
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<WriteResult | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const rewrite = async (): Promise<void> => {
    if (!source.trim()) return
    setBusy(true)
    setError(null)
    setResult(null)
    const t0 = performance.now()
    try {
      const r = await window.api.writing.improve(source, mode)
      setResult(r)
      setElapsed((performance.now() - t0) / 1000)
    } catch (err) {
      setError(writeErrorText(t, err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  const copyOut = async (): Promise<void> => {
    if (!result) return
    await navigator.clipboard.writeText(result.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="writing-view">
      <header className="writing-view__header">
        <h1 className="writing-view__title">{t('writing.title')}</h1>
        <p className="writing-view__sub">{t('writing.subtitle')}</p>
      </header>

      <div className="writing-view__modes" role="tablist" aria-label={t('writing.modeLabel')}>
        {WRITING_MODES.map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={`writing-view__mode ${mode === m ? 'writing-view__mode--active' : ''}`}
            onClick={() => setMode(m)}
          >
            {t(`writing.mode.${m}`)}
          </button>
        ))}
      </div>

      <div className="writing-view__workbench">
        <div className="writing-view__pane">
          <div className="writing-view__pane-head">
            <span className="writing-view__pane-label">{t('writing.sourceLabel')}</span>
          </div>
          <textarea
            className="writing-view__textarea"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={t('writing.sourcePlaceholder')}
            spellCheck={false}
          />
        </div>

        <div className="writing-view__controls">
          <button
            className="writing-view__btn writing-view__btn--primary"
            disabled={busy || !source.trim()}
            onClick={() => void rewrite()}
          >
            {busy ? t('writing.rewriting') : t('writing.rewrite')}
            {!busy && <ArrowRight size={15} aria-hidden="true" />}
          </button>
        </div>

        <div className="writing-view__pane">
          <div className="writing-view__pane-head">
            <span className="writing-view__pane-label">{t('writing.resultLabel')}</span>
            {result && (
              <button
                type="button"
                className="writing-view__copy"
                onClick={() => void copyOut()}
                aria-label={t('writing.copy')}
                title={t('writing.copy')}
              >
                {copied ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Copy size={14} aria-hidden="true" />
                )}
              </button>
            )}
          </div>
          <div className="writing-view__output">
            {error ? (
              <span className="writing-view__output-error">{error}</span>
            ) : result ? (
              result.text
            ) : (
              <span className="writing-view__output-empty">{t('writing.outputEmpty')}</span>
            )}
          </div>
          {result && elapsed != null && (
            <div className="writing-view__meta">
              {t('writing.meta', {
                mode: t(`writing.mode.${result.mode}`),
                lang: t(result.detected === 'de' ? 'writing.langDe' : 'writing.langEn'),
                s: elapsed.toFixed(1),
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

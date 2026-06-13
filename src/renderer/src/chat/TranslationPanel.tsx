import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { TranslateResult, TranslationLanguage, TranslatorStatus } from '@shared/translation'
import { stripCitationMarkers } from '@shared/citationMarkers'
import { MarkdownView } from '../markdown/MarkdownView'
import { useSettings } from '../settings/useSettings'
import { useT } from '../i18n'

// Inline translate panel under an assistant message. Self-contained on
// purpose: status , languages and the translate call all go straight to
// window.api.translation , so MessageList only owns "which message has the
// panel open". The first translate after app start spawns the sidecar and
// loads the 3 GB model (seconds) — the busy label says so.

type Props = {
  content: string
  onClose: () => void
}

export function TranslationPanel({ content, onClose }: Props): JSX.Element {
  const t = useT()
  const { settings } = useSettings()
  // Translate into the UI language by default — the common case for a DE/EN
  // user staring at a source in a language they don't read.
  const uiLang = settings?.basic.language === 'de' ? 'de' : 'en'

  const [status, setStatus] = useState<TranslatorStatus | null>(null)
  const [languages, setLanguages] = useState<TranslationLanguage[]>([])
  const [target, setTarget] = useState<string>(uiLang)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TranslateResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void window.api.translation.status().then((s) => {
      if (mounted) setStatus(s)
    })
    void window.api.translation.languages().then((l) => {
      if (mounted) setLanguages(l)
    })
    return () => {
      mounted = false
    }
  }, [])

  const installed =
    status !== null &&
    status.sidecarAvailable &&
    (status.state === 'installed' || status.state === 'starting' || status.state === 'ready')

  const translate = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      // Strip [doc:N, chunk:M] citation markers before translating: they're
      // noise in a translation , and feeding them to MADLAD mangles them (it
      // hallucinated "2000-2001" out of one). The assistant's markdown itself
      // (**bold** , lists , `code`) survives translation and renders below.
      setResult(await window.api.translation.translate(stripCitationMarkers(content), { target }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const langName = (code: string): string => languages.find((l) => l.code === code)?.name ?? code

  return (
    <div className="chat__translate" role="region" aria-label={t('chat.translateTitle')}>
      <div className="chat__translate-row">
        <span className="chat__translate-title">{t('chat.translateTitle')}</span>
        {installed && (
          <>
            <select
              className="chat__translate-select"
              value={target}
              disabled={busy}
              aria-label={t('chat.translateTargetAria')}
              onChange={(e) => setTarget(e.target.value)}
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="chat__translate-btn"
              disabled={busy}
              onClick={() => void translate()}
            >
              {busy ? t('chat.translateBusy') : t('chat.translateAction')}
            </button>
          </>
        )}
        <button
          type="button"
          className="chat__msg-action chat__translate-close"
          onClick={onClose}
          aria-label={t('chat.translateClose')}
          title={t('chat.translateClose')}
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>

      {status !== null && !installed && (
        <div className="chat__translate-hint">
          {status.sidecarAvailable
            ? t('chat.translateNotInstalled')
            : t('settings.translation.sidecarMissing')}
        </div>
      )}
      {busy && <div className="chat__translate-hint">{t('chat.translateBusyHint')}</div>}
      {error && <div className="chat__translate-error">{error}</div>}
      {result && (
        <>
          <div className="chat__translate-result">
            <MarkdownView>{result.text}</MarkdownView>
          </div>
          <div className="chat__translate-meta">
            {result.detected
              ? t('chat.translateMetaDetected', {
                  from: langName(result.detected),
                  to: langName(target),
                  s: (result.ms / 1000).toFixed(1),
                })
              : t('chat.translateMeta', {
                  to: langName(target),
                  s: (result.ms / 1000).toFixed(1),
                })}
          </div>
        </>
      )}
    </div>
  )
}

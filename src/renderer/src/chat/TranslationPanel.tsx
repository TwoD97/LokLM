import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { TranslateResult, TranslationLanguage, TranslatorStatus } from '@shared/translation'
import { stripCitationMarkers } from '@shared/citationMarkers'
import { MarkdownView } from '../markdown/MarkdownView'
import { useSettings } from '../settings/useSettings'
import { useGeneration } from '../generation/GenerationContext'
import { useT } from '../i18n'
import { useTranslationRequest } from '../translation/useTranslationRequest'

// Inline translate panel under an assistant message. Self-contained on
// purpose: status , languages and the translate call all go straight to
// window.api.translation , so MessageList only owns "which message has the
// panel open". Translation shares chat's selected language model.

type Props = {
  content: string
  onClose: () => void
}

export function TranslationPanel({ content, onClose }: Props): JSX.Element {
  const t = useT()
  const { settings } = useSettings()
  const { begin: beginGeneration } = useGeneration()
  const { runTranslation, cancel, progress } = useTranslationRequest()
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
    const off = window.api.translation.onStatus((s) => mounted && setStatus(s))
    return () => {
      mounted = false
      off()
    }
  }, [])

  const installed = status !== null && status.state !== 'not_installed'

  const translate = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    const endGeneration = beginGeneration('translation')
    try {
      // References remain on the original answer; translate its prose/Markdown.
      setResult(await runTranslation(stripCitationMarkers(content), target))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      endGeneration()
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
              onChange={(e) => {
                setTarget(e.target.value)
                setResult(null)
              }}
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
            {busy && (
              <button type="button" className="chat__translate-btn" onClick={cancel}>
                {t('translation.cancel')}
              </button>
            )}
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
        <div className="chat__translate-hint">{t('chat.translateNotInstalled')}</div>
      )}
      {busy && <div className="chat__translate-hint">{t('chat.translateBusyHint')}</div>}
      {busy && progress && (
        <div className="chat__translate-hint" role="status">
          {t('translation.progress', { n: progress.completed, total: progress.total })}
        </div>
      )}
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

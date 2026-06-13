import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, Copy, Check, Save } from 'lucide-react'
import type { ModelDownloadEvent } from '@preload/index'
import type { Document, Workspace } from '@shared/documents'
import type { TranslateResult, TranslationLanguage, TranslatorStatus } from '@shared/translation'
import { useSettings } from '../settings/useSettings'
import { useT } from '../i18n'
import './translation.css'

// Standalone translation page (DeepL-style): paste text on the left , pick a
// target language , get the translation on the right. Two source modes — free
// text , or a document pulled from a workspace which can be saved back as a new
// translated document. Self-contained: it owns the model-download flow too , so
// a first-time user can land here , download MADLAD , and translate without
// going through Settings.

type SourceMode = 'text' | 'document'

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export function TranslationView(): JSX.Element {
  const t = useT()
  const { settings } = useSettings()
  const uiLang = settings?.basic.language === 'de' ? 'de' : 'en'

  const [status, setStatus] = useState<TranslatorStatus | null>(null)
  const [languages, setLanguages] = useState<TranslationLanguage[]>([])
  const [progress, setProgress] = useState<ModelDownloadEvent | null>(null)

  const [source, setSource] = useState('')
  const [target, setTarget] = useState<string>(uiLang)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TranslateResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Document mode: pick a workspace doc , load its indexed text , translate ,
  // optionally save the translation back as a new document.
  const [sourceMode, setSourceMode] = useState<SourceMode>('text')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [docs, setDocs] = useState<Document[]>([])
  const [wsId, setWsId] = useState<number | null>(null)
  const [docId, setDocId] = useState<number | null>(null)
  const [docTitle, setDocTitle] = useState('')
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedTitle, setSavedTitle] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void window.api.translation.status().then((s) => mounted && setStatus(s))
    void window.api.translation.languages().then((l) => mounted && setLanguages(l))
    const offStatus = window.api.translation.onStatus((s) => setStatus(s))
    let offProgress: (() => void) | null = null
    let cancelled = false
    void window.api.models
      .onProgress((ev: ModelDownloadEvent) => {
        if (ev.id.startsWith('translator-')) setProgress(ev)
      })
      .then((off) => (cancelled ? off() : (offProgress = off)))
    return () => {
      mounted = false
      cancelled = true
      offStatus()
      if (offProgress) offProgress()
    }
  }, [])

  // Load workspaces lazily the first time the user opens document mode.
  useEffect(() => {
    if (sourceMode !== 'document' || workspaces.length > 0) return
    void window.api.workspaces.list().then((ws) => {
      setWorkspaces(ws)
      setWsId((cur) => cur ?? (ws.length > 0 ? ws[0]!.id : null))
    })
  }, [sourceMode, workspaces.length])

  // Document list follows the selected workspace.
  useEffect(() => {
    if (wsId == null) {
      setDocs([])
      return
    }
    let mounted = true
    void window.api.documents.list(wsId).then((d) => mounted && setDocs(d))
    return () => {
      mounted = false
    }
  }, [wsId])

  const state = status?.state ?? null
  const ready = state === 'installed' || state === 'starting' || state === 'ready'
  const sidecarMissing = status !== null && !status.sidecarAvailable

  const langName = (code: string): string => languages.find((l) => l.code === code)?.name ?? code

  const loadDocument = async (id: number): Promise<void> => {
    setDocId(id)
    setResult(null)
    setSavedTitle(null)
    setError(null)
    setLoadingDoc(true)
    try {
      const { title, text } = await window.api.translation.documentText(id)
      setDocTitle(title)
      setSource(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingDoc(false)
    }
  }

  const translate = async (): Promise<void> => {
    if (!source.trim()) return
    setBusy(true)
    setError(null)
    setResult(null)
    setSavedTitle(null)
    try {
      setResult(await window.api.translation.translate(source, { target }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const saveTranslation = async (): Promise<void> => {
    if (!result || wsId == null) return
    setSaving(true)
    setError(null)
    try {
      const doc = await window.api.translation.saveDocument(
        wsId,
        docTitle || 'document',
        result.text,
        target,
      )
      setSavedTitle(doc.title)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const copyOut = async (): Promise<void> => {
    if (!result) return
    await navigator.clipboard.writeText(result.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="translation-view">
      <header className="translation-view__header">
        <h1 className="translation-view__title">{t('translation.title')}</h1>
        <p className="translation-view__sub">{t('translation.subtitle')}</p>
      </header>

      {sidecarMissing && (
        <div className="translation-view__notice translation-view__notice--warn">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{t('settings.translation.sidecarMissing')}</span>
        </div>
      )}

      {/* Not installed / downloading / error → install card. */}
      {status !== null && !ready && !sidecarMissing && (
        <div className="translation-view__install">
          <p className="translation-view__install-copy">{t('settings.translation.installHint')}</p>
          {state === 'downloading' ? (
            <>
              <div className="translation-view__progress-bar">
                <div
                  className="translation-view__progress-fill"
                  style={{
                    width:
                      progress && progress.totalBytes > 0
                        ? `${Math.min(100, (progress.bytesReceived / progress.totalBytes) * 100)}%`
                        : '0%',
                  }}
                />
              </div>
              <div className="translation-view__progress-text">
                {progress
                  ? t('settings.translation.progress', {
                      pct:
                        progress.totalBytes > 0
                          ? Math.round((progress.bytesReceived / progress.totalBytes) * 100)
                          : 0,
                      received: fmtBytes(progress.bytesReceived),
                      total: fmtBytes(progress.totalBytes),
                    })
                  : t('settings.translation.progressIndeterminate')}
              </div>
              <button
                className="translation-view__btn"
                onClick={() => void window.api.translation.cancelInstall()}
              >
                {t('settings.translation.cancel')}
              </button>
            </>
          ) : (
            <>
              {state === 'error' && status.message && (
                <div className="translation-view__notice translation-view__notice--warn">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>{status.message}</span>
                </div>
              )}
              <button
                className="translation-view__btn translation-view__btn--primary"
                onClick={() => {
                  setProgress(null)
                  void window.api.translation.install().catch(() => undefined)
                }}
              >
                {state === 'error'
                  ? t('settings.translation.retry')
                  : t('settings.translation.install')}
              </button>
            </>
          )}
        </div>
      )}

      {/* Installed → the translate workbench. */}
      {ready && (
        <>
          <div className="translation-view__tabs" role="tablist">
            <button
              role="tab"
              aria-selected={sourceMode === 'text'}
              className={`translation-view__tab ${sourceMode === 'text' ? 'translation-view__tab--active' : ''}`}
              onClick={() => setSourceMode('text')}
            >
              {t('translation.tabText')}
            </button>
            <button
              role="tab"
              aria-selected={sourceMode === 'document'}
              className={`translation-view__tab ${sourceMode === 'document' ? 'translation-view__tab--active' : ''}`}
              onClick={() => setSourceMode('document')}
            >
              {t('translation.tabDocument')}
            </button>
          </div>

          {sourceMode === 'document' && (
            <div className="translation-view__docpick">
              <select
                className="translation-view__select"
                value={wsId ?? ''}
                aria-label={t('translation.pickWorkspace')}
                onChange={(e) => {
                  setWsId(Number(e.target.value))
                  setDocId(null)
                  setSource('')
                  setResult(null)
                  setSavedTitle(null)
                }}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <select
                className="translation-view__select"
                value={docId ?? ''}
                aria-label={t('translation.pickDocument')}
                disabled={docs.length === 0}
                onChange={(e) => void loadDocument(Number(e.target.value))}
              >
                <option value="" disabled>
                  {docs.length === 0 ? t('translation.noDocuments') : t('translation.pickDocument')}
                </option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="translation-view__workbench">
            <div className="translation-view__pane">
              <div className="translation-view__pane-head">
                <span className="translation-view__pane-label">{t('translation.sourceLabel')}</span>
                {result?.detected && (
                  <span className="translation-view__detected">
                    {t('translation.detected', { lang: langName(result.detected) })}
                  </span>
                )}
              </div>
              <textarea
                className="translation-view__textarea"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder={
                  loadingDoc ? t('translation.loadingDoc') : t('translation.sourcePlaceholder')
                }
                spellCheck={false}
              />
            </div>

            <div className="translation-view__controls">
              <select
                className="translation-view__select"
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
                className="translation-view__btn translation-view__btn--primary"
                disabled={busy || !source.trim()}
                onClick={() => void translate()}
              >
                {busy ? t('chat.translateBusy') : t('translation.translate')}
                {!busy && <ArrowRight size={15} aria-hidden="true" />}
              </button>
              {state === 'starting' && (
                <span className="translation-view__hint">{t('chat.translateBusyHint')}</span>
              )}
            </div>

            <div className="translation-view__pane">
              <div className="translation-view__pane-head">
                <span className="translation-view__pane-label">
                  {t('translation.targetLabel', { lang: langName(target) })}
                </span>
                {result && (
                  <button
                    type="button"
                    className="translation-view__copy"
                    onClick={() => void copyOut()}
                    aria-label={t('chat.copy')}
                    title={t('chat.copy')}
                  >
                    {copied ? (
                      <Check size={14} aria-hidden="true" />
                    ) : (
                      <Copy size={14} aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
              <div className="translation-view__output">
                {error ? (
                  <span className="translation-view__output-error">{error}</span>
                ) : result ? (
                  result.text
                ) : (
                  <span className="translation-view__output-empty">
                    {t('translation.outputEmpty')}
                  </span>
                )}
              </div>
              {result && (
                <div className="translation-view__meta">
                  {t('translation.meta', { s: (result.ms / 1000).toFixed(1), n: result.sentences })}
                </div>
              )}
              {sourceMode === 'document' && result && wsId != null && (
                <div className="translation-view__saverow">
                  <button
                    className="translation-view__btn"
                    disabled={saving}
                    onClick={() => void saveTranslation()}
                  >
                    <Save size={14} aria-hidden="true" />
                    {saving ? t('translation.saving') : t('translation.saveToWorkspace')}
                  </button>
                  {savedTitle && (
                    <span className="translation-view__saved">
                      <Check size={13} aria-hidden="true" />{' '}
                      {t('translation.savedAs', { title: savedTitle })}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

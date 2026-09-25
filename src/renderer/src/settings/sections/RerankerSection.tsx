import { SectionHeader } from './SectionHeader'
import { useEffect, useId, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { UserSettings } from '@shared/settings'
import type { RerankerInfo } from '@shared/documents'
import { Segmented } from '../Segmented'
import { useT } from '../../i18n'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

export function RerankerSection({ settings, update }: Props): JSX.Element {
  const t = useT()
  const sectionId = useId()
  const [open, setOpen] = useState(true)
  const [info, setInfo] = useState<RerankerInfo | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const a = settings.advanced.reranker
  const ollamaRerankerModel = settings.advanced.ollama.rerankerModel
  const mode = a.enabled ? (a.policy ?? 'auto') : 'off'
  useEffect(() => {
    let current = true
    setInfo(null)
    void window.api.reranker
      .info()
      .then((value) => {
        if (current) setInfo(value)
      })
      .catch(() => {
        if (current) setInfo(null)
      })
    return () => {
      current = false
    }
  }, [a.enabled, a.policy, a.source])
  const save = async (patch: unknown): Promise<void> => {
    setSaving(true)
    setSaveFailed(false)
    try {
      await update(patch)
    } catch {
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }
  const decision = info?.policyDecision
  const statusKey =
    mode === 'off'
      ? 'prefs.rerankOff'
      : a.source === 'ollama'
        ? 'prefs.external'
        : decision?.reason === 'low-vram'
          ? 'prefs.rerankLow'
          : decision?.reason === 'gpu-unavailable'
            ? 'prefs.gpuRequired'
            : !decision || decision.reason === 'unknown-vram'
              ? 'prefs.rerankUnknown'
              : 'prefs.rerankOn'
  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <SectionHeader
        id={sectionId}
        title={t('settings.reranker.title')}
        subtitle={t('settings.reranker.sub')}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      />
      <div
        id={`${sectionId}-body`}
        role="region"
        aria-labelledby={`${sectionId}-title`}
        hidden={!open}
      >
        <div className="settings-group__body">
          <div className="settings-row">
            <div className="settings-row__label">
              <label className="settings-row__label-text" htmlFor={`${sectionId}-mode`}>
                {t('prefs.reranker')}
              </label>
              <span id={`${sectionId}-hint`} className="settings-row__hint">
                {t('prefs.rerankerHint')}
              </span>
            </div>
            <select
              id={`${sectionId}-mode`}
              aria-describedby={`${sectionId}-hint`}
              value={mode}
              disabled={saving}
              onChange={(event) => {
                const value = event.target.value
                void save({
                  advanced: {
                    reranker: {
                      enabled: value !== 'off',
                      policy: value === 'always' ? 'always' : 'auto',
                    },
                  },
                })
              }}
            >
              <option value="auto">{t('prefs.auto')}</option>
              <option value="always">{t('prefs.always')}</option>
              <option value="off">{t('prefs.off')}</option>
            </select>
          </div>
          <p className="preferences-policy" role="status">
            {t(saving ? 'prefs.saving' : statusKey)}
          </p>
          {mode === 'always' && (
            <p className="preferences-description">{t('prefs.rerankAlwaysHint')}</p>
          )}
          {saveFailed && (
            <p className="preferences-error" role="alert">
              {t('prefs.saveFailed')}
            </p>
          )}
          {a.enabled && (
            <>
              <div className="settings-row">
                <div className="settings-row__label">
                  <span className="settings-row__label-text">{t('settings.reranker.source')}</span>
                  <span className="settings-row__hint">{t('settings.reranker.sourceHint')}</span>
                </div>
                <Segmented
                  ariaLabel={t('settings.reranker.sourceAria')}
                  value={a.source}
                  options={[
                    { value: 'bundled', label: t('settings.reranker.bundled'), disabled: saving },
                    {
                      value: 'ollama',
                      label: t('settings.reranker.externalOllama'),
                      disabled: saving || !ollamaRerankerModel,
                      hint: ollamaRerankerModel ? undefined : t('settings.reranker.pickModelFirst'),
                    },
                  ]}
                  onChange={(v) => void save({ advanced: { reranker: { source: v } } })}
                />
              </div>
              {a.source === 'ollama' && (
                <div className="settings-inline-warning">
                  <span className="settings-inline-warning__icon" aria-hidden="true">
                    <AlertTriangle size={14} />
                  </span>
                  <span>{t('settings.reranker.ollamaWarning')}</span>
                </div>
              )}
              {/* The reranker rides the LLM's primary GPU backend (one shared
                  device), so it has no independent compute-device control — the
                  LLM's Auto/Dedicated/Integrated choice governs it. */}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

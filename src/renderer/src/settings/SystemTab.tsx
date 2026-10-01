import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Cpu } from 'lucide-react'
import type { RerankerInfo, SystemInfo } from '@shared/documents'
import { RERANKER_AUTO_MIN_VRAM_GIB } from '@shared/modelCapabilities'
import { useSettings } from './useSettings'
import { useT } from '../i18n'

export function SystemTab({ onOpenAdvanced }: { onOpenAdvanced?: () => void }): JSX.Element {
  const t = useT()
  const { settings, update } = useSettings()
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [reranker, setReranker] = useState<RerankerInfo | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryFailed, setRetryFailed] = useState(false)
  const refreshId = useRef(0)
  const refresh = useCallback(async () => {
    const id = ++refreshId.current
    setLoadFailed(false)
    try {
      const [system, rerank, active] = await Promise.all([
        window.api.llm.info(),
        window.api.reranker.info(),
        window.api.llm.status(),
      ])
      if (id !== refreshId.current) return
      // Hardware measurements describe the bundled model; status identifies
      // the live provider, including a request that fell back to the local GPU.
      setInfo({ ...system, ...active, source: active.fallback?.active ? 'bundled' : active.source })
      setReranker(rerank)
    } catch {
      if (id === refreshId.current) setLoadFailed(true)
    }
  }, [])
  useEffect(() => {
    let lastState = ''
    const off = window.api.llm.onStatus((status) => {
      const key = `${status.state}:${status.resident}:${status.source}:${status.fallback?.active}`
      if (key === lastState) return
      lastState = key
      void refresh()
    })
    const offReranker = window.api.reranker.onStatus((status) => {
      setReranker((previous) => (previous ? { ...previous, ...status } : previous))
    })
    void refresh()
    return () => {
      off()
      offReranker()
      // This is a cancellation generation counter, not a captured DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      refreshId.current++
    }
  }, [refresh])
  if (!settings) return <p>{t('settings.loading')}</p>
  const decision = reranker?.policyDecision
  const resources = info?.resources as { totalVramGB?: number; hasGpu?: boolean } | null
  const vram = info?.modelCapacity?.totalVramGB ?? decision?.totalVramGB ?? resources?.totalVramGB
  const external = info?.source === 'ollama'
  const modelMissing = info?.source === 'bundled' && info.bundledModelExists === false
  const modelFailed = info?.state === 'failed'
  const preparing = retrying || info?.state === 'loading'
  const noGpu = !external && (decision?.reason === 'gpu-unavailable' || resources?.hasGpu === false)
  const lowMemory = !external && vram != null && vram > 0 && vram <= RERANKER_AUTO_MIN_VRAM_GIB
  const partial = !external && info?.modelCapacity?.fullyOnGpu === false
  const measured = !external && (info?.resolvedPlacement === 'gpu' || resources?.hasGpu === true)
  const capacity = info?.modelCapacity
  const mode = !settings.advanced.reranker.enabled
    ? 'off'
    : (settings.advanced.reranker.policy ?? 'auto')
  const save = async (value: string): Promise<void> => {
    setSaving(true)
    setSaveFailed(false)
    try {
      await update({
        advanced: {
          reranker: { enabled: value !== 'off', policy: value === 'always' ? 'always' : 'auto' },
        },
      })
      await refresh()
    } catch {
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }
  const unknown = t('prefs.unknown')
  const retry = async (): Promise<void> => {
    setRetrying(true)
    setRetryFailed(false)
    try {
      await window.api.models.warmupForQa()
      await refresh()
    } catch {
      setRetryFailed(true)
    } finally {
      setRetrying(false)
    }
  }
  return (
    <div className="preferences-system">
      {loadFailed ? (
        <div className="preferences-error" role="alert">
          {t('prefs.loadFailed')} <button onClick={() => void refresh()}>{t('prefs.retry')}</button>
        </div>
      ) : !info ? (
        <p role="status">{t('settings.loading')}</p>
      ) : (
        <>
          {(modelMissing || modelFailed) && (
            <section className="preferences-model-issue" aria-label={t('startup.settings')}>
              <strong>{t(modelMissing ? 'startup.modelMissing' : 'startup.modelFailed')}</strong>
              <p>{t(modelMissing ? 'startup.modelMissingHint' : 'startup.modelFailedHint')}</p>
              <div className="preferences-model-issue__actions">
                {onOpenAdvanced && (
                  <button onClick={onOpenAdvanced}>{t('startup.advanced')}</button>
                )}
                <button disabled={preparing} onClick={() => void retry()}>
                  {t(preparing ? 'startup.retrying' : 'startup.retry')}
                </button>
              </div>
              {retryFailed && <p role="alert">{t('startup.readError')}</p>}
              {info.message && (
                <details>
                  <summary>{t('startup.technical')}</summary>
                  <p>{info.message}</p>
                </details>
              )}
            </section>
          )}
          <div
            className={`preferences-capacity ${noGpu || lowMemory || partial ? 'preferences-capacity--limited' : ''}`}
          >
            {noGpu || lowMemory || partial ? (
              <AlertTriangle size={22} aria-hidden="true" />
            ) : measured ? (
              <CheckCircle2 size={22} aria-hidden="true" />
            ) : (
              <Cpu size={22} aria-hidden="true" />
            )}
            <div>
              <strong>
                {t(
                  noGpu
                    ? 'prefs.gpuRequired'
                    : lowMemory
                      ? 'prefs.lowMemory'
                      : partial
                        ? 'prefs.partial'
                        : external
                          ? 'prefs.external'
                          : measured
                            ? 'prefs.ready'
                            : 'prefs.unknown',
                )}
              </strong>
              <p>
                {t(
                  noGpu
                    ? 'prefs.gpuRequiredHint'
                    : lowMemory
                      ? 'prefs.lowMemoryHint'
                      : partial
                        ? 'prefs.partialHint'
                        : external
                          ? 'prefs.externalHint'
                          : measured
                            ? 'prefs.readyHint'
                            : 'prefs.notMeasuredHint',
                )}
              </p>
            </div>
          </div>
          {partial && lowMemory && (
            <p className="preferences-capacity-note">
              <strong>{t('prefs.partial')}.</strong> {t('prefs.partialHint')}
            </p>
          )}
          <dl className="preferences-hardware">
            <div>
              <dt>{t('prefs.gpuMemory')}</dt>
              <dd>{vram != null && vram > 0 ? `${vram.toFixed(1)} GiB` : unknown}</dd>
            </div>
            <div>
              <dt>{t('prefs.systemMemory')}</dt>
              <dd>{info.totalMemGB} GB</dd>
            </div>
            <div className="preferences-hardware__wide">
              <dt>{t('prefs.gpu')}</dt>
              <dd>{info.gpuName ?? unknown}</dd>
            </div>
            <div className="preferences-hardware__wide">
              <dt>{t('prefs.chatModel')}</dt>
              <dd>
                {external
                  ? settings.advanced.ollama.llmModel || unknown
                  : (info.modelName ?? unknown)}
              </dd>
            </div>
            <div>
              <dt>{t('prefs.layers')}</dt>
              <dd>
                {external
                  ? t('prefs.external')
                  : capacity
                    ? `${capacity.gpuLayers}${capacity.totalModelLayers ? ` / ${capacity.totalModelLayers}` : ''}`
                    : unknown}
              </dd>
            </div>
            <div>
              <dt>{t('prefs.context')}</dt>
              <dd>
                {external
                  ? t('prefs.external')
                  : (capacity?.contextSize?.toLocaleString(settings.basic.language) ?? unknown)}
              </dd>
            </div>
          </dl>
        </>
      )}
      <div className="preferences-reranker">
        <label className="preferences-field">
          <span>{t('prefs.reranker')}</span>
          <select
            value={mode}
            disabled={saving}
            onChange={(event) => void save(event.target.value)}
          >
            <option value="auto">{t('prefs.auto')}</option>
            <option value="always">{t('prefs.always')}</option>
            <option value="off">{t('prefs.off')}</option>
          </select>
        </label>
        <p className="preferences-description">{t('prefs.rerankerHint')}</p>
        <p className="preferences-policy" role="status">
          {saving
            ? t('prefs.saving')
            : t(
                mode === 'off'
                  ? 'prefs.rerankOff'
                  : decision?.reason === 'external'
                    ? 'prefs.external'
                    : decision?.reason === 'low-vram'
                      ? 'prefs.rerankLow'
                      : decision?.reason === 'gpu-unavailable'
                        ? 'prefs.gpuRequired'
                        : !decision || decision.reason === 'unknown-vram'
                          ? 'prefs.rerankUnknown'
                          : 'prefs.rerankOn',
              )}
        </p>
        {mode === 'always' && (
          <p className="preferences-description">{t('prefs.rerankAlwaysHint')}</p>
        )}
        {saveFailed && (
          <p className="preferences-error" role="alert">
            {t('prefs.saveFailed')}
          </p>
        )}
      </div>
    </div>
  )
}

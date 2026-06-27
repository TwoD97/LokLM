import { useEffect, useState } from 'react'
import type { UserSettings } from '@shared/settings'
import type { SystemInfo, LlmPlacementChoice } from '@shared/documents'
import { Segmented } from '../Segmented'
import { useT } from '../../i18n'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

export function LlmSection({ settings, update }: Props): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(true)
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const a = settings.advanced.llm
  const hasOllama = Boolean(settings.advanced.ollama.baseUrl && settings.advanced.ollama.llmModel)

  // System info gives the install-time GPU inventory (which picker options to
  // offer) + the resolved device of the last load. Refreshed on a placement
  // change via the same reload that re-resolves the device.
  const refreshInfo = (): void => {
    void window.api.llm.info().then(setInfo)
  }
  useEffect(refreshInfo, [])

  const gpus = info?.availableGpus ?? []
  const hasDedicated = gpus.some((g) => g.kind === 'dedicated')
  const hasIntegrated = gpus.some((g) => g.kind === 'integrated')
  // Legacy persisted 'cpu'/'gpu' (or any non-class value) shows as Auto.
  const placementValue: LlmPlacementChoice =
    a.placement === 'dedicated' || a.placement === 'integrated' ? a.placement : 'auto'
  const activeKind =
    info?.gpuKind === 'dedicated'
      ? t('settings.llm.kindDedicated')
      : info?.gpuKind === 'integrated'
        ? t('settings.llm.kindIntegrated')
        : null
  const ctxOptions: { value: string; label: string }[] = [
    { value: 'auto', label: t('settings.llm.ctxAuto') },
    { value: '4096', label: '4 K' },
    { value: '8192', label: '8 K' },
    { value: '16384', label: '16 K' },
    { value: '32768', label: '32 K' },
    { value: '65536', label: '64 K' },
    { value: '131072', label: '128 K' },
  ]
  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <div className="settings-group__title">
          <div className="settings-group__title-row">{t('settings.llm.title')}</div>
          <div className="settings-group__sub">{t('settings.llm.sub')}</div>
        </div>
        <span className="settings-group__chevron">▶</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">{t('settings.llm.source')}</span>
              <span className="settings-row__hint">{t('settings.llm.sourceHint')}</span>
            </div>
            <Segmented
              ariaLabel={t('settings.llm.sourceAria')}
              value={a.source}
              options={[
                { value: 'bundled', label: t('settings.llm.bundled') },
                {
                  value: 'ollama',
                  label: t('settings.llm.externalOllama'),
                  disabled: !hasOllama,
                  hint: hasOllama ? undefined : t('settings.llm.configureOllamaFirst'),
                },
              ]}
              onChange={(v) => void update({ advanced: { llm: { source: v } } })}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">{t('settings.llm.placement')}</span>
              <span className="settings-row__hint">{t('settings.llm.placementHint')}</span>
            </div>
            <Segmented
              ariaLabel={t('settings.llm.placementAria')}
              // CPU is no longer selectable — a GPU is required. The picker
              // chooses a device CLASS: Dedicated (discrete card) vs Integrated
              // (iGPU). An option is disabled when the machine has no GPU of that
              // class in the install-time inventory.
              value={placementValue}
              options={[
                { value: 'auto', label: t('settings.llm.placementAuto') },
                {
                  value: 'dedicated',
                  label: t('settings.llm.placementDedicated'),
                  disabled: !hasDedicated,
                  hint: hasDedicated ? undefined : t('settings.llm.noDedicated'),
                },
                {
                  value: 'integrated',
                  label: t('settings.llm.placementIntegrated'),
                  disabled: !hasIntegrated,
                  hint: hasIntegrated ? undefined : t('settings.llm.noIntegrated'),
                },
              ]}
              // Reload so the new device takes effect before the next answer
              // (the worker restarts when the physical device changes), then
              // refresh the resolved-device label.
              onChange={(v) =>
                void update({ advanced: { llm: { placement: v } } })
                  .then(() => window.api.llm.reload())
                  .then(refreshInfo)
              }
            />
            {info?.gpuName && (
              <div className="settings-row__hint" style={{ marginTop: 6 }}>
                {t('settings.llm.activeDevice', {
                  device: info.gpuName,
                  kind: activeKind ?? '—',
                })}
              </div>
            )}
            {info && info.gpuName && info.pinnedDeviceVerified === false && (
              <div className="settings-inline-warning" style={{ marginTop: 6 }}>
                <span>{t('settings.llm.deviceUnconfirmed')}</span>
              </div>
            )}
          </div>
          <div className="settings-block">
            <div className="settings-block__head">
              <div className="settings-block__head-text">
                <span className="settings-block__label">{t('settings.llm.contextSize')}</span>
                <span className="settings-block__hint">{t('settings.llm.contextSizeHint')}</span>
              </div>
            </div>
            <Segmented
              ariaLabel={t('settings.llm.contextSize')}
              value={a.contextChoice === 'auto' ? 'auto' : String(a.contextChoice)}
              options={ctxOptions}
              onChange={(v) => {
                const next = v === 'auto' ? 'auto' : Number(v)
                void update({ advanced: { llm: { contextChoice: next } } })
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

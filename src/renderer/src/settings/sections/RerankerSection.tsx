import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { UserSettings } from '@shared/settings'
import { Segmented } from '../Segmented'
import { useT } from '../../i18n'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

export function RerankerSection({ settings, update }: Props): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(true)
  const a = settings.advanced.reranker
  const ollamaRerankerModel = settings.advanced.ollama.rerankerModel
  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <div className="settings-group__title">
          <div className="settings-group__title-row">{t('settings.reranker.title')}</div>
          <div className="settings-group__sub">{t('settings.reranker.sub')}</div>
        </div>
        <span className="settings-group__chevron">▶</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">{t('settings.reranker.source')}</span>
              <span className="settings-row__hint">{t('settings.reranker.sourceHint')}</span>
            </div>
            <Segmented
              ariaLabel={t('settings.reranker.sourceAria')}
              value={a.source}
              options={[
                { value: 'bundled', label: t('settings.reranker.bundled') },
                {
                  value: 'ollama',
                  label: t('settings.reranker.externalOllama'),
                  disabled: !ollamaRerankerModel,
                  hint: ollamaRerankerModel ? undefined : t('settings.reranker.pickModelFirst'),
                },
              ]}
              onChange={(v) => void update({ advanced: { reranker: { source: v } } })}
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
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">{t('settings.reranker.placement')}</span>
              <span className="settings-row__hint">{t('settings.reranker.placementHint')}</span>
            </div>
            <Segmented
              ariaLabel={t('settings.reranker.placementAria')}
              value={a.placement}
              options={[
                { value: 'auto', label: t('settings.reranker.placementAuto') },
                { value: 'cpu', label: t('settings.reranker.placementCpu') },
                { value: 'gpu', label: t('settings.reranker.placementGpu') },
              ]}
              onChange={(v) => void update({ advanced: { reranker: { placement: v } } })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

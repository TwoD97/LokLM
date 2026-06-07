import { useState } from 'react'
import type { UserSettings } from '@shared/settings'
import { Slider } from '../Slider'
import { useT } from '../../i18n'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

export function IndexingSection({ settings, update }: Props): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(true)
  const r = settings.retrieval
  return (
    <div className={`settings-group ${open ? 'settings-group--open' : ''}`}>
      <div className="settings-group__header" onClick={() => setOpen((o) => !o)}>
        <div className="settings-group__title">
          <div className="settings-group__title-row">{t('settings.indexing.title')}</div>
          <div className="settings-group__sub">{t('settings.indexing.sub')}</div>
        </div>
        <span className="settings-group__chevron">▶</span>
      </div>
      {open && (
        <div className="settings-group__body">
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">{t('settings.indexing.chunkSize')}</span>
              <span className="settings-row__hint">{t('settings.indexing.chunkSizeHint')}</span>
            </div>
            <Slider
              ariaLabel={t('settings.indexing.chunkSize')}
              value={r.chunkSize}
              min={500}
              max={8000}
              step={100}
              onChange={(v) => void update({ retrieval: { chunkSize: v } })}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">{t('settings.indexing.overlap')}</span>
              <span className="settings-row__hint">{t('settings.indexing.overlapHint')}</span>
            </div>
            <Slider
              ariaLabel={t('settings.indexing.overlap')}
              value={r.chunkOverlap}
              min={0}
              max={500}
              step={50}
              onChange={(v) => void update({ retrieval: { chunkOverlap: v } })}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__label-text">{t('settings.indexing.topK')}</span>
              <span className="settings-row__hint">{t('settings.indexing.topKHint')}</span>
            </div>
            <Slider
              ariaLabel={t('settings.indexing.topK')}
              value={r.topK}
              min={3}
              max={30}
              step={1}
              onChange={(v) => void update({ retrieval: { topK: v } })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

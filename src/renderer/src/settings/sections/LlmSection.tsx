import { useState } from 'react'
import type { UserSettings } from '@shared/settings'
import { Segmented } from '../Segmented'
import { useT } from '../../i18n'

type Props = { settings: UserSettings; update: (patch: unknown) => Promise<void> }

export function LlmSection({ settings, update }: Props): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(true)
  const a = settings.advanced.llm
  const hasOllama = Boolean(settings.advanced.ollama.baseUrl && settings.advanced.ollama.llmModel)
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

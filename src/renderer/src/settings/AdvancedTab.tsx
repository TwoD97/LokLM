import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Brain,
  Check,
  Languages,
  Plug,
  Search,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { useSettings } from './useSettings'
import { LlmSection } from './sections/LlmSection'
import { EmbedderSection } from './sections/EmbedderSection'
import { RerankerSection } from './sections/RerankerSection'
import { IndexingSection } from './sections/IndexingSection'
import { DiagnosticsSection } from './sections/DiagnosticsSection'
import { BehaviorSection } from './sections/BehaviorSection'
import { TranslationSection } from './sections/TranslationSection'
import { OllamaSection } from './OllamaSection'
import { useT } from '../i18n'
import { DEFAULT_SETTINGS } from '@shared/settings'

type SubTab = 'llm' | 'retrieval' | 'behavior' | 'translation' | 'ollama' | 'diagnostics'

// Install-time opt-in from the tier marker — immutable while the app runs ,
// so fetch it once at module load. The settings modal can't be opened before
// this resolves in practice , which keeps the subtab list correct on first
// paint ( no flash of a tab that's about to disappear ).
let ollamaConnectorUnlocked = true
const ollamaConnectorPromise = window.api.ollama
  .connectorEnabled()
  .then((v) => (ollamaConnectorUnlocked = v))
  .catch(() => true)

const SUBTABS: { id: SubTab; labelKey: string; Icon: LucideIcon }[] = [
  { id: 'llm', labelKey: 'settings.advanced.subtabLlm', Icon: Brain },
  { id: 'retrieval', labelKey: 'settings.advanced.subtabRetrieval', Icon: Search },
  { id: 'behavior', labelKey: 'settings.advanced.subtabBehavior', Icon: SlidersHorizontal },
  { id: 'translation', labelKey: 'settings.advanced.subtabTranslation', Icon: Languages },
  { id: 'ollama', labelKey: 'settings.advanced.subtabOllama', Icon: Plug },
  { id: 'diagnostics', labelKey: 'settings.advanced.subtabDiagnostics', Icon: BarChart3 },
]

export function AdvancedTab(): JSX.Element {
  const t = useT()
  const { settings, update, savedFlash } = useSettings()
  const [confirmReset, setConfirmReset] = useState(false)
  const [sub, setSub] = useState<SubTab>('llm')
  // When the wizard checkbox was left unticked the Ollama subtab doesn't
  // exist at all — by design there is no in-app way to enable the connector ;
  // re-running the installer is. The effect only matters in the unlikely
  // case the modal mounts before the module-level prefetch resolved.
  const [ollamaUnlocked, setOllamaUnlocked] = useState(ollamaConnectorUnlocked)
  useEffect(() => {
    void ollamaConnectorPromise.then((enabled) => {
      setOllamaUnlocked(enabled)
      // The tab the user is on just disappeared — fall back to the first one.
      if (!enabled) setSub((s) => (s === 'ollama' ? 'llm' : s))
    })
  }, [])

  if (!settings) return <div>{t('settings.loading')}</div>

  const subtabs = SUBTABS.filter((st) => st.id !== 'ollama' || ollamaUnlocked)

  return (
    <div>
      <div className="settings-advanced-banner">
        <span className="settings-advanced-banner__icon" aria-hidden="true">
          <AlertTriangle size={16} />
        </span>
        <span>
          <strong>{t('settings.advanced.bannerStrong')}</strong> {t('settings.advanced.bannerBody')}{' '}
          <em>{t('settings.advanced.bannerResetWord')}</em> {t('settings.advanced.bannerBodyTail')}
        </span>
      </div>

      <div className="settings-subtabs" role="tablist">
        {subtabs.map((st) => (
          <button
            key={st.id}
            role="tab"
            aria-selected={sub === st.id}
            className={`settings-subtab ${sub === st.id ? 'settings-subtab--active' : ''}`}
            onClick={() => setSub(st.id)}
          >
            <span className="settings-subtab__icon" aria-hidden="true">
              <st.Icon size={16} />
            </span>
            {t(st.labelKey)}
          </button>
        ))}
      </div>

      {sub === 'llm' && <LlmSection settings={settings} update={update} />}
      {sub === 'retrieval' && (
        <>
          <IndexingSection settings={settings} update={update} />
          <EmbedderSection settings={settings} update={update} />
          <RerankerSection settings={settings} update={update} />
        </>
      )}
      {sub === 'behavior' && <BehaviorSection settings={settings} update={update} />}
      {sub === 'translation' && <TranslationSection />}
      {sub === 'ollama' && ollamaUnlocked && <OllamaSection settings={settings} update={update} />}
      {sub === 'diagnostics' && <DiagnosticsSection />}

      <div className="settings-reset-row">
        <span className="settings-reset-row__copy">{t('settings.advanced.resetCopy')}</span>
        {!confirmReset ? (
          <button className="settings-btn--danger" onClick={() => setConfirmReset(true)}>
            {t('settings.advanced.reset')}
          </button>
        ) : (
          <button
            className="settings-btn--danger-confirm"
            onClick={async () => {
              await update({ advanced: DEFAULT_SETTINGS.advanced })
              setConfirmReset(false)
            }}
          >
            {t('settings.advanced.resetConfirm')}
          </button>
        )}
        <span className={`settings-saved-flash ${savedFlash ? 'settings-saved-flash--on' : ''}`}>
          <Check size={14} aria-hidden="true" /> {t('settings.basic.saved')}
        </span>
      </div>
    </div>
  )
}

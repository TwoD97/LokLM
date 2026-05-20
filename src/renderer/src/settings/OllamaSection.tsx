import type { UserSettings } from '@shared/settings'

export function OllamaSection(props: {
  settings: UserSettings
  update: (patch: unknown) => Promise<void>
}): JSX.Element {
  void props
  return (
    <div className="settings-group">
      <div className="settings-group__header">External Ollama</div>
    </div>
  )
}

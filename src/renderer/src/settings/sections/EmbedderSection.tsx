import type { UserSettings } from '@shared/settings'

export function EmbedderSection(props: {
  settings: UserSettings
  update: (patch: unknown) => Promise<void>
}): JSX.Element {
  void props
  return (
    <div className="settings-group">
      <div className="settings-group__header">Embedder</div>
    </div>
  )
}

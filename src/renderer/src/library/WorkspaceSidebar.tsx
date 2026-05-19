import { useState } from 'react'
import type { Workspace } from '@shared/documents'

type Props = {
  workspaces: Workspace[]
  activeId: number | null
  onSelect: (id: number) => void
  onCreate: (name: string) => void
}

export function WorkspaceSidebar({ workspaces, activeId, onSelect, onCreate }: Props): JSX.Element {
  const [draft, setDraft] = useState('')
  return (
    <aside className="library__sidebar">
      <h2>Workspaces</h2>
      {workspaces.map((w) => (
        <button
          key={w.id}
          className={`library__ws ${w.id === activeId ? 'library__ws--active' : ''}`}
          onClick={() => onSelect(w.id)}
        >
          {w.name}
        </button>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim().length === 0) return
          onCreate(draft.trim())
          setDraft('')
        }}
        style={{ marginTop: 12 }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="+ Neuer Workspace"
          style={{
            width: '100%',
            padding: '8px',
            borderRadius: 6,
            background: '#0f1a2a',
            color: 'inherit',
            border: '1px solid #243a55',
          }}
        />
      </form>
    </aside>
  )
}

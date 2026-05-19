import type { Document, IndexProgress } from '@shared/documents'
import { DocumentRow } from './DocumentRow'

type Props = {
  docs: Document[]
  progress: Map<number, IndexProgress>
  onDelete: (id: number) => void
  onReindex: (id: number) => void
}

export function DocumentTable({ docs, progress, onDelete, onReindex }: Props): JSX.Element {
  if (docs.length === 0) {
    return (
      <div className="library__empty">Noch keine Dokumente. Dateien per Drag-Drop importieren.</div>
    )
  }
  return (
    <table className="library__table">
      <thead>
        <tr>
          <th>Titel</th>
          <th>Status</th>
          <th>Chunks</th>
          <th>Hinzugefügt</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {docs.map((d) => {
          const p = progress.get(d.id)
          return (
            <DocumentRow
              key={d.id}
              doc={d}
              {...(p !== undefined ? { progress: p } : {})}
              onDelete={onDelete}
              onReindex={onReindex}
            />
          )
        })}
      </tbody>
    </table>
  )
}

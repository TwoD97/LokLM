// Folder-organization strings (user-created folders in the chat sidebar + the
// Library "Folders" view). Keys are 'folders.*', English-first, EN fallback.
import type { DomainDict } from './types'

export const foldersDict: DomainDict = {
  en: {
    'folders.new': 'New folder',
    'folders.newSubfolder': 'New subfolder',
    'folders.rename': 'Rename',
    'folders.delete': 'Delete folder',
    'folders.deleteConfirm': 'Delete folder “{name}”? The documents inside move to Unfiled.',
    'folders.namePlaceholder': 'Folder name',
    'folders.scopeFolder': 'Add folder to chat scope',
  },
  de: {
    'folders.new': 'Neuer Ordner',
    'folders.newSubfolder': 'Neuer Unterordner',
    'folders.rename': 'Umbenennen',
    'folders.delete': 'Ordner löschen',
    'folders.deleteConfirm':
      'Ordner „{name}“ löschen? Die enthaltenen Dokumente werden nach „Nicht zugeordnet“ verschoben.',
    'folders.namePlaceholder': 'Ordnername',
    'folders.scopeFolder': 'Ordner zum Chat-Bereich hinzufügen',
  },
}

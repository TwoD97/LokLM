// library domain strings. Keys are 'library.*' , English-first , EN is the fallback.
// Owned by the i18n agent for this domain — fill both en + de.
import type { DomainDict } from './types'

export const libraryDict: DomainDict = {
  en: {
    // LibraryView
    'library.exportTitle': 'Export document',
    'library.exportBody':
      '"{title}" leaves the vault as an unencrypted copy. Enter your password to confirm.',
    'library.exportLabel': 'Export',
    'library.exportFailed': 'Export failed: {message}',
    'library.sourceNotFound': 'Source file not found:\n{path}',
    'library.cannotOpenFile': 'Cannot open file: {message}',
    'library.dropZone': 'Click to choose — or drag files here.',
    // DocumentTable
    'library.empty': 'No documents yet. Import files via drag-and-drop.',
    'library.colTitle': 'Title',
    'library.colStatus': 'Status',
    'library.colChunks': 'Chunks',
    'library.colAdded': 'Added',
    'library.loadingMore': '… {count} more loading',
    // DocumentRow
    'library.sourceMissing': 'Source file missing',
    'library.actions': 'actions',
    'library.read': 'Read',
    'library.export': 'Export…',
    'library.revealInFolder': 'Show in folder',
    'library.openExternal': 'Open externally',
    'library.refresh': 'Refresh',
    'library.replaceFile': 'Replace file…',
    'library.reindex': 'Reindex',
    'library.delete': 'Delete',
    'library.langMixedTitle': 'Document contains chunks in both languages',
    'library.docLanguageTitle': 'Document language: {language}',
    'library.langGerman': 'German',
    'library.langEnglish': 'English',
    // DocumentPreview
    'library.previewAria': 'Preview: {title}',
    'library.closePreview': 'Close preview',
    'library.closeEsc': 'Close (Esc)',
    'library.loading': 'Loading…',
    'library.noChunks': 'No chunks available — index the document.',
    'library.previewDoc': 'Document preview',
    'library.chunkLanguageTitle': 'Chunk language: {language}',
    // MissingDocsBanner
    'library.missingOne': '1 file no longer found',
    'library.missingMany': '{count} files no longer found',
    'library.keep': 'Keep',
    'library.keepTitle': 'Keep in library (search still works, source is missing)',
    'library.removeTitle': 'Remove document and its chunks from the library',
    // SyncFoldersPanel
    'library.noFolderConnected': 'No folder connected',
    'library.foldersConnected': '{count} folders connected',
    'library.folderSync': 'Folder sync · {summary}',
    'library.syncIntro':
      'Connect folders and LokLM imports new files automatically and reindexes changed ones. Deleted files are marked as "no longer found" — you decide whether to keep or remove them.',
    'library.removeFolder': 'Remove {folder}',
    'library.removeFromSyncTitle': 'Remove from sync (documents stay in the library)',
    'library.addFolder': 'Add folder',
    'library.syncing': 'Syncing…',
    'library.syncNow': 'Sync now',
    'library.scanning': 'Scanning…',
    'library.syncProgress': '{detail} · new {imported} · reindex {reindexed} · missing {missing}',
    'library.syncDone':
      'Done · new {imported} · reindex {reindexed} · missing {missing} · unchanged {unchanged}',
    'library.syncFailed': 'Error: {detail}',
    'library.syncFailedUnknown': 'unknown',
  },
  de: {
    // LibraryView
    'library.exportTitle': 'Dokument exportieren',
    'library.exportBody':
      '„{title}“ verlässt den Tresor als unverschlüsselte Kopie. Passwort zur Bestätigung eingeben.',
    'library.exportLabel': 'Exportieren',
    'library.exportFailed': 'Export fehlgeschlagen: {message}',
    'library.sourceNotFound': 'Quelldatei nicht gefunden:\n{path}',
    'library.cannotOpenFile': 'Datei kann nicht geöffnet werden: {message}',
    'library.dropZone': 'Klicken zum Auswählen – oder Dateien hierher ziehen.',
    // DocumentTable
    'library.empty': 'Noch keine Dokumente. Dateien per Drag-Drop importieren.',
    'library.colTitle': 'Titel',
    'library.colStatus': 'Status',
    'library.colChunks': 'Chunks',
    'library.colAdded': 'Hinzugefügt',
    'library.loadingMore': '… {count} weitere werden geladen',
    // DocumentRow
    'library.sourceMissing': 'Quelldatei fehlt',
    'library.actions': 'Aktionen',
    'library.read': 'Lesen',
    'library.export': 'Exportieren…',
    'library.revealInFolder': 'Im Ordner zeigen',
    'library.openExternal': 'Extern öffnen',
    'library.refresh': 'Aktualisieren',
    'library.replaceFile': 'Datei ersetzen…',
    'library.reindex': 'Reindex',
    'library.delete': 'Löschen',
    'library.langMixedTitle': 'Dokument enthält Chunks in beiden Sprachen',
    'library.docLanguageTitle': 'Dokumentsprache: {language}',
    'library.langGerman': 'Deutsch',
    'library.langEnglish': 'Englisch',
    // DocumentPreview
    'library.previewAria': 'Vorschau: {title}',
    'library.closePreview': 'Vorschau schließen',
    'library.closeEsc': 'Schließen (Esc)',
    'library.loading': 'Lade…',
    'library.noChunks': 'Keine Chunks vorhanden — Dokument indexieren.',
    'library.previewDoc': 'Dokumentvorschau',
    'library.chunkLanguageTitle': 'Chunk-Sprache: {language}',
    // MissingDocsBanner
    'library.missingOne': '1 Datei nicht mehr gefunden',
    'library.missingMany': '{count} Dateien nicht mehr gefunden',
    'library.keep': 'Behalten',
    'library.keepTitle': 'In Bibliothek belassen (Suche funktioniert weiter, Quelle fehlt)',
    'library.removeTitle': 'Dokument samt Chunks aus der Bibliothek entfernen',
    // SyncFoldersPanel
    'library.noFolderConnected': 'Kein Ordner verbunden',
    'library.foldersConnected': '{count} Ordner verbunden',
    'library.folderSync': 'Ordner-Sync · {summary}',
    'library.syncIntro':
      'Verbinde Ordner und LokLM importiert neue Dateien automatisch und reindiziert geänderte. Gelöschte Dateien werden als „nicht mehr gefunden“ markiert – du entscheidest selbst über behalten oder entfernen.',
    'library.removeFolder': '{folder} entfernen',
    'library.removeFromSyncTitle': 'Aus Sync entfernen (Dokumente bleiben in der Bibliothek)',
    'library.addFolder': 'Ordner hinzufügen',
    'library.syncing': 'Synchronisiere…',
    'library.syncNow': 'Jetzt synchronisieren',
    'library.scanning': 'Scanne…',
    'library.syncProgress': '{detail} · neu {imported} · reindex {reindexed} · fehlt {missing}',
    'library.syncDone':
      'Fertig · neu {imported} · reindex {reindexed} · fehlt {missing} · unverändert {unchanged}',
    'library.syncFailed': 'Fehler: {detail}',
    'library.syncFailedUnknown': 'unbekannt',
  },
}

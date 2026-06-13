// translation domain strings ( the standalone Translation page ). Keys are
// 'translation.*' , English-first , EN is the fallback. The chat-panel and
// settings-section translation strings live in dict_chat / dict_settings; this
// file is just the full-page workbench.
import type { DomainDict } from './types'

export const translationDict: DomainDict = {
  en: {
    'translation.title': 'Translation',
    'translation.subtitle':
      'Offline machine translation — runs locally on your machine, nothing leaves the device.',
    'translation.sourceLabel': 'Source text',
    'translation.sourcePlaceholder': 'Type or paste text to translate…',
    'translation.targetLabel': 'Translation ({lang})',
    'translation.translate': 'Translate',
    'translation.detected': 'Detected: {lang}',
    'translation.outputEmpty': 'The translation appears here.',
    'translation.meta': '{s} s · {n} sentences',
    'translation.tabText': 'Text',
    'translation.tabDocument': 'Document',
    'translation.pickWorkspace': 'Workspace',
    'translation.pickDocument': 'Choose a document…',
    'translation.noDocuments': 'No documents',
    'translation.loadingDoc': 'Loading document…',
    'translation.saveToWorkspace': 'Save to workspace',
    'translation.saving': 'Saving…',
    'translation.savedAs': 'Saved as “{title}”',
  },
  de: {
    'translation.title': 'Übersetzung',
    'translation.subtitle':
      'Offline-Maschinenübersetzung — läuft lokal auf deinem Rechner, nichts verlässt das Gerät.',
    'translation.sourceLabel': 'Ausgangstext',
    'translation.sourcePlaceholder': 'Text zum Übersetzen eingeben oder einfügen…',
    'translation.targetLabel': 'Übersetzung ({lang})',
    'translation.translate': 'Übersetzen',
    'translation.detected': 'Erkannt: {lang}',
    'translation.outputEmpty': 'Die Übersetzung erscheint hier.',
    'translation.meta': '{s} s · {n} Sätze',
    'translation.tabText': 'Text',
    'translation.tabDocument': 'Dokument',
    'translation.pickWorkspace': 'Workspace',
    'translation.pickDocument': 'Dokument wählen…',
    'translation.noDocuments': 'Keine Dokumente',
    'translation.loadingDoc': 'Dokument wird geladen…',
    'translation.saveToWorkspace': 'In Workspace speichern',
    'translation.saving': 'Wird gespeichert…',
    'translation.savedAs': 'Gespeichert als „{title}“',
  },
}

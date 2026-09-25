// translation domain strings ( the standalone Translation page ). Keys are
// 'translation.*' , English-first , EN is the fallback. The chat-panel and
// settings-section translation strings live in dict_chat / dict_settings; this
// file is just the full-page workbench.
import type { DomainDict } from './types'

export const translationDict: DomainDict = {
  en: {
    'translation.refreshDocuments': 'Refresh documents',
    'translation.checking': 'Checking translation availability…',
    'translation.statusFailed': 'Could not check the model. Retry to continue.',
    'translation.copyFailed': 'Could not copy. Select the translation to copy it manually.',
    'translation.stopping': 'Stopping…',
    'translation.stopped': 'Translation stopped. Your source text is still here.',
    'translation.title': 'Translation',
    'translation.subtitle':
      'Translate with your selected language model. The bundled model runs entirely on your device.',
    'translation.sourceLabel': 'Source text',
    'translation.sourcePlaceholder': 'Type or paste text to translate…',
    'translation.targetLabel': 'Translation ({lang})',
    'translation.targetLabelShort': 'Translate to',
    'translation.translate': 'Translate',
    'translation.cancel': 'Stop',
    'translation.progress': '{n} of {total} sections translated',
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
    'translation.refreshDocuments': 'Dokumente aktualisieren',
    'translation.checking': 'Verfügbarkeit der Übersetzung wird geprüft…',
    'translation.statusFailed': 'Das Modell konnte nicht geprüft werden. Bitte erneut versuchen.',
    'translation.copyFailed':
      'Kopieren fehlgeschlagen. Markiere die Übersetzung, um sie manuell zu kopieren.',
    'translation.stopping': 'Wird gestoppt…',
    'translation.stopped': 'Übersetzung gestoppt. Dein Ausgangstext bleibt erhalten.',
    'translation.title': 'Übersetzung',
    'translation.subtitle':
      'Übersetze mit deinem ausgewählten Sprachmodell. Das integrierte Modell läuft vollständig auf deinem Gerät.',
    'translation.sourceLabel': 'Ausgangstext',
    'translation.sourcePlaceholder': 'Text zum Übersetzen eingeben oder einfügen…',
    'translation.targetLabel': 'Übersetzung ({lang})',
    'translation.targetLabelShort': 'Übersetzen nach',
    'translation.translate': 'Übersetzen',
    'translation.cancel': 'Stoppen',
    'translation.progress': '{n} von {total} Abschnitten übersetzt',
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

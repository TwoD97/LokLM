// models domain strings. Keys are 'models.*' , English-first , EN is the fallback.
// Owned by the i18n agent for this domain — fill both en + de.
import type { DomainDict } from './types'

export const modelsDict: DomainDict = {
  en: {
    'models.loadingStatus': 'Loading model status…',
    'models.welcome': 'Welcome to LokLM',
    'models.intro':
      'For the first launch we download the language model and helper files (≈ {size} total). This happens only once — after that everything runs fully local.',
    'models.row.waiting': 'Waiting for download',
    'models.row.progress': '{received} / {total}',
    'models.row.progressWithRate': '{received} / {total} · {rate}',
    'models.row.verifying': 'Verifying …',
    'models.row.ready': 'Ready',
    'models.row.cancelled': 'Cancelled — can be resumed',
    'models.row.error': 'Error: {message}',
    'models.row.errorUnknown': 'unknown',
    'models.space.insufficient':
      'Not enough free space: requires {required}, available {available}.',
    'models.action.retry': 'Retry',
    'models.action.startDownload': 'Start download',
    'models.action.cancel': 'Cancel',
    'models.action.continue': 'Continue',
    'models.overall': 'Total: {downloaded} / {total} · {pct}%',
    'models.location': 'Location: ',
  },
  de: {
    'models.loadingStatus': 'Lade Modellstatus…',
    'models.welcome': 'Willkommen bei LokLM',
    'models.intro':
      'Für den ersten Start laden wir das Sprachmodell und die Hilfsdateien herunter (insgesamt ≈ {size}). Das passiert nur einmal — danach läuft alles vollständig lokal.',
    'models.row.waiting': 'Wartet auf Download',
    'models.row.progress': '{received} / {total}',
    'models.row.progressWithRate': '{received} / {total} · {rate}',
    'models.row.verifying': 'Verifiziere …',
    'models.row.ready': 'Bereit',
    'models.row.cancelled': 'Abgebrochen — kann fortgesetzt werden',
    'models.row.error': 'Fehler: {message}',
    'models.row.errorUnknown': 'unbekannt',
    'models.space.insufficient':
      'Nicht genug freier Speicher: benötigt {required}, verfügbar {available}.',
    'models.action.retry': 'Erneut versuchen',
    'models.action.startDownload': 'Download starten',
    'models.action.cancel': 'Abbrechen',
    'models.action.continue': 'Weiter',
    'models.overall': 'Gesamt: {downloaded} / {total} · {pct}%',
    'models.location': 'Speicherort: ',
  },
}

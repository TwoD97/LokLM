// Universal UI actions shared across domains. Owned centrally ( NOT by any
// per-domain i18n agent ) so every component can reference common.* without
// edit-collisions. If you need a generic verb/label that's missing here, add
// it here once rather than duplicating into a domain dict.
import type { DomainDict } from './types'

export const commonDict: DomainDict = {
  en: {
    'common.close': 'Close',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.confirm': 'Confirm',
    'common.search': 'Search',
    'common.loading': 'Loading…',
    'common.error': 'Error',
    'common.retry': 'Retry',
    'common.remove': 'Remove',
    'common.add': 'Add',
    'common.open': 'Open',
    'common.yes': 'Yes',
    'common.no': 'No',
  },
  de: {
    'common.close': 'Schließen',
    'common.cancel': 'Abbrechen',
    'common.save': 'Speichern',
    'common.delete': 'Löschen',
    'common.back': 'Zurück',
    'common.next': 'Weiter',
    'common.confirm': 'Bestätigen',
    'common.search': 'Suchen',
    'common.loading': 'Wird geladen…',
    'common.error': 'Fehler',
    'common.retry': 'Erneut versuchen',
    'common.remove': 'Entfernen',
    'common.add': 'Hinzufügen',
    'common.open': 'Öffnen',
    'common.yes': 'Ja',
    'common.no': 'Nein',
  },
}

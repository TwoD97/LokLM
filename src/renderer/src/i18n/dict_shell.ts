// shell domain strings. Keys are 'shell.*' , English-first , EN is the fallback.
// Owned by the i18n agent for this domain — fill both en + de.
import type { DomainDict } from './types'

export const shellDict: DomainDict = {
  en: {
    // App.tsx
    'shell.loading': 'Loading …',
    'shell.errorTitle': 'Error',
    'shell.tagline': 'Local AI knowledge assistant',
    'shell.recoveryWordsTitle': 'Recovery words',

    // TitleBar.tsx — status pills
    'shell.modelStatus': 'Model status',
    'shell.settings': 'Settings',
    'shell.minimize': 'Minimize',
    'shell.restore': 'Restore',
    'shell.maximize': 'Maximize',
    'shell.locationRemote': 'Remote',
    'shell.locationLocal': 'Local',
    'shell.statusRunning': 'Running · {where}',
    'shell.statusLoading': 'Loading · {where}',
    'shell.statusFailed': 'Failed · {where}',
    'shell.statusUnloaded': 'Unloaded · {where}',
    'shell.statusIdle': 'Idle · {where}',

    // AppShell.tsx
    'shell.selectWorkspaceFirst': 'Create or select a workspace first.',

    // Sidebar.tsx
    'shell.navLibrary': 'Library',
    'shell.navChat': 'Chat',
    'shell.navQuiz': 'Quiz',
    'shell.navTranscription': 'Transcription',
    'shell.workspaces': 'Workspaces',
    'shell.pinSidebar': 'Pin sidebar',
    'shell.unpinSidebar': 'Unpin sidebar',
    'shell.scopeFiles': 'Scope: {count} {noun}',
    'shell.scopeFileSingular': 'file',
    'shell.scopeFilePlural': 'files',
    'shell.scopeAllDocuments': 'Scope: All documents',
    'shell.clearScope': 'Clear document scope',
    'shell.clear': 'Clear',
    'shell.noDocumentsYet': 'No documents yet',
    'shell.newWorkspace': '+ New workspace',
    'shell.renameWorkspace': 'Rename workspace',
    'shell.deleteWorkspace': 'Delete workspace',
    'shell.deleteWorkspaceTitle': 'Delete workspace?',
    'shell.deleteWorkspaceBody':
      'Delete “{name}” and all of its documents, chats and quizzes? This cannot be undone.',

    // ErrorBoundary.tsx
    'shell.unknownError': 'Unknown error',
  },
  de: {
    // App.tsx
    'shell.loading': 'Lade …',
    'shell.errorTitle': 'Fehler',
    'shell.tagline': 'Lokaler KI-Wissensassistent',
    'shell.recoveryWordsTitle': 'Wiederherstellungs-Wörter',

    // TitleBar.tsx — status pills
    'shell.modelStatus': 'Modellstatus',
    'shell.settings': 'Einstellungen',
    'shell.minimize': 'Minimieren',
    'shell.restore': 'Wiederherstellen',
    'shell.maximize': 'Maximieren',
    'shell.locationRemote': 'Remote',
    'shell.locationLocal': 'Lokal',
    'shell.statusRunning': 'Läuft · {where}',
    'shell.statusLoading': 'Lädt · {where}',
    'shell.statusFailed': 'Fehlgeschlagen · {where}',
    'shell.statusUnloaded': 'Entladen · {where}',
    'shell.statusIdle': 'Inaktiv · {where}',

    // AppShell.tsx
    'shell.selectWorkspaceFirst': 'Erstelle oder wähle zuerst einen Workspace.',

    // Sidebar.tsx
    'shell.navLibrary': 'Bibliothek',
    'shell.navChat': 'Chat',
    'shell.navQuiz': 'Quiz',
    'shell.navTranscription': 'Transkription',
    'shell.workspaces': 'Workspaces',
    'shell.pinSidebar': 'Seitenleiste anheften',
    'shell.unpinSidebar': 'Seitenleiste lösen',
    'shell.scopeFiles': 'Bereich: {count} {noun}',
    'shell.scopeFileSingular': 'Datei',
    'shell.scopeFilePlural': 'Dateien',
    'shell.scopeAllDocuments': 'Bereich: Alle Dokumente',
    'shell.clearScope': 'Dokumentbereich zurücksetzen',
    'shell.clear': 'Zurücksetzen',
    'shell.noDocumentsYet': 'Noch keine Dokumente',
    'shell.newWorkspace': '+ Neuer Workspace',
    'shell.renameWorkspace': 'Workspace umbenennen',
    'shell.deleteWorkspace': 'Workspace löschen',
    'shell.deleteWorkspaceTitle': 'Workspace löschen?',
    'shell.deleteWorkspaceBody':
      '„{name}“ und alle zugehörigen Dokumente, Chats und Quizze löschen? Das kann nicht rückgängig gemacht werden.',

    // ErrorBoundary.tsx
    'shell.unknownError': 'Unbekannter Fehler',
  },
}

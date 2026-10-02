// chat domain strings. Keys are 'chat.*' , English-first , EN is the fallback.
// Owned by the i18n agent for this domain — fill both en + de.
import type { DomainDict } from './types'

export const chatDict: DomainDict = {
  en: {
    'chat.loadFailed': 'Could not load the conversation. Select it again to retry. {message}',
    'chat.sendFailed':
      'The request could not finish. Your text is kept here; try sending again. {message}',
    'chat.copyFailed': 'Could not copy. Select the message to copy it manually.',
    // ChatInput
    'chat.inputPlaceholder':
      'Ask a question about your documents… (Enter to send · Shift+Enter for a new line)',
    'chat.cancelStreaming': 'Cancel streaming',
    'chat.cancel': 'Cancel',
    'chat.sendMessage': 'Send message',
    'chat.sendHint': 'Send (Enter)',
    'chat.copy': 'Copy',
    'chat.regenerate': 'Regenerate',
    'chat.regenerateFailed': 'Could not regenerate the previous turn. Try again.',
    // TranslationPanel
    'chat.translate': 'Translate',
    'chat.translateTitle': 'Translate',
    'chat.translateTargetAria': 'Target language',
    'chat.translateAction': 'Translate',
    'chat.translateBusy': 'Translating…',
    'chat.translateBusyHint':
      'Uses your selected language model. Long texts are translated in sections.',
    'chat.translateClose': 'Close translation',
    'chat.translateNotInstalled':
      'No language model available. Check Settings → Advanced → Language model.',
    'chat.translateMetaDetected': '{from} → {to} · {s} s',
    'chat.translateMeta': '→ {to} · {s} s',
    // ChatHeader
    'chat.viaOllama': 'via Ollama',
    'chat.viaOllamaFallback': 'via Ollama → bundled (fallback)',
    'chat.deleteConversation': 'Delete conversation',
    // ChatView
    'chat.newChat': 'New chat',
    'chat.conversationFallback': 'Conversation #{id}',
    'chat.sourcePreview': 'Source preview',
    'chat.deleteConversationTitle': 'Delete conversation?',
    'chat.deleteConversationBody': 'This permanently removes "{title}" and all its messages.',
    'chat.streamError': 'Error: {message}',
    // ConversationList
    'chat.newChatButton': '+ New chat',
    'chat.noConversations': 'No conversations yet.',
    'chat.messageCount': '{count} messages',
    // MessageList
    'chat.emptyState': 'Ask a question about your documents.',
    'chat.stageRoute': 'Route',
    'chat.stageContextualize': 'Contextualize',
    'chat.stageExpandQueries': 'Expand query',
    'chat.stageRetrieve': 'Search',
    'chat.stageRerank': 'Rerank',
    'chat.stageSummarize': 'Summarize',
    'chat.stageCorpus': 'Library lookup',
    'chat.stageEvidence': 'Comparing sources',
    'chat.stagePrefill': 'Preparing answer',
    // Collapsible pipeline dropdown
    'chat.pipelineDone': 'Done · {ms}',
    'chat.pipelineIncomplete': 'Incomplete',
    'chat.pipelineToggle': 'Toggle pipeline details',
    'chat.generating': 'Generating…',
    'chat.metricsPipeline': 'pipeline {ms} · ',
    'chat.metricsTtft': 'TTFT {s} s',
    'chat.metricsTokensPerSec': ' · {rate} tok/s',
    'chat.metricsTokens': ' · {count} tok',
    // Source navigation distinguishes cited passages from supplied context.
    'chat.groundingOne': '1 cited source',
    'chat.groundingMany': '{count} cited sources',
    'chat.sourcesPopoverTitle': 'Cited sources',
    'chat.providedSources': 'Provided sources · {count}',
    'chat.providedSourcesTitle': 'Provided sources',
    'chat.documentFallback': 'Document #{id}',
    // Fallback sources footer — shown when the model answered from the fed
    // chunks but emitted no inline citation markers.
    'chat.sources': 'Sources',
    // SourceViewer
    'chat.sourceViewer': 'Source viewer',
    'chat.chunkFallback': 'Chunk #{id}',
    'chat.highlightHintTitle': '{snippets}\n(click to jump to the next highlight)',
    'chat.highlightOne': '1 highlight',
    'chat.highlightMany': '{count} highlights',
    'chat.closeSourceViewer': 'Close source viewer',
    'chat.closeEsc': 'Close (Esc)',
    'chat.documentPreview': 'Document preview',
    'chat.noChunks': 'No chunks available for this document.',
    // MultiPagePdfPreview
    'chat.pdfPreviewFailed': 'PDF preview failed: {message}',
    'chat.loadingPdf': 'Loading PDF…',
    'chat.pageLabel': 'p. {n}',
    'chat.rendering': 'Rendering…',
  },
  de: {
    'chat.loadFailed':
      'Der Chat konnte nicht geladen werden. Wähle ihn erneut, um es noch einmal zu versuchen. {message}',
    'chat.sendFailed':
      'Die Anfrage konnte nicht abgeschlossen werden. Dein Text bleibt erhalten; versuche es erneut. {message}',
    'chat.copyFailed':
      'Kopieren fehlgeschlagen. Markiere die Nachricht, um sie manuell zu kopieren.',
    // ChatInput
    'chat.inputPlaceholder':
      'Stelle eine Frage zu deinen Dokumenten… (Enter senden · Shift+Enter neue Zeile)',
    'chat.cancelStreaming': 'Streaming abbrechen',
    'chat.cancel': 'Abbrechen',
    'chat.sendMessage': 'Nachricht senden',
    'chat.sendHint': 'Senden (Enter)',
    'chat.copy': 'Kopieren',
    'chat.regenerate': 'Neu erzeugen',
    'chat.regenerateFailed':
      'Die letzte Antwort konnte nicht neu erzeugt werden. Bitte erneut versuchen.',
    // TranslationPanel
    'chat.translate': 'Übersetzen',
    'chat.translateTitle': 'Übersetzen',
    'chat.translateTargetAria': 'Zielsprache',
    'chat.translateAction': 'Übersetzen',
    'chat.translateBusy': 'Übersetzt…',
    'chat.translateBusyHint':
      'Verwendet dein ausgewähltes Sprachmodell. Lange Texte werden abschnittsweise übersetzt.',
    'chat.translateClose': 'Übersetzung schließen',
    'chat.translateNotInstalled':
      'Kein Sprachmodell verfügbar. Prüfe Einstellungen → Erweitert → Sprachmodell.',
    'chat.translateMetaDetected': '{from} → {to} · {s} s',
    'chat.translateMeta': '→ {to} · {s} s',
    // ChatHeader
    'chat.viaOllama': 'über Ollama',
    'chat.viaOllamaFallback': 'über Ollama → integriert (Fallback)',
    'chat.deleteConversation': 'Unterhaltung löschen',
    // ChatView
    'chat.newChat': 'Neuer Chat',
    'chat.conversationFallback': 'Unterhaltung #{id}',
    'chat.sourcePreview': 'Quellenvorschau',
    'chat.deleteConversationTitle': 'Unterhaltung löschen?',
    'chat.deleteConversationBody':
      'Dies entfernt „{title}“ und alle zugehörigen Nachrichten dauerhaft.',
    'chat.streamError': 'Fehler: {message}',
    // ConversationList
    'chat.newChatButton': '+ Neuer Chat',
    'chat.noConversations': 'Noch keine Unterhaltungen.',
    'chat.messageCount': '{count} Nachrichten',
    // MessageList
    'chat.emptyState': 'Stelle eine Frage zu deinen Dokumenten.',
    'chat.stageRoute': 'Route',
    'chat.stageContextualize': 'Kontextualisieren',
    'chat.stageExpandQueries': 'Query erweitern',
    'chat.stageRetrieve': 'Suchen',
    'chat.stageRerank': 'Reranken',
    'chat.stageSummarize': 'Zusammenfassen',
    'chat.stageCorpus': 'Bibliotheksabfrage',
    'chat.stageEvidence': 'Quellen vergleichen',
    'chat.stagePrefill': 'Antwort vorbereiten',
    // Collapsible pipeline dropdown
    'chat.pipelineDone': 'Fertig · {ms}',
    'chat.pipelineIncomplete': 'Nicht abgeschlossen',
    'chat.pipelineToggle': 'Pipeline-Details umschalten',
    'chat.generating': 'Wird erzeugt…',
    'chat.metricsPipeline': 'Pipeline {ms} · ',
    'chat.metricsTtft': 'TTFT {s} s',
    'chat.metricsTokensPerSec': ' · {rate} Tok/s',
    'chat.metricsTokens': ' · {count} Tok',
    // Source navigation distinguishes cited passages from supplied context.
    'chat.groundingOne': '1 zitierte Quelle',
    'chat.groundingMany': '{count} zitierte Quellen',
    'chat.sourcesPopoverTitle': 'Zitierte Quellen',
    'chat.providedSources': 'Quellen im Kontext · {count}',
    'chat.providedSourcesTitle': 'Quellen im Kontext',
    'chat.documentFallback': 'Dokument #{id}',
    // Fallback sources footer — shown when the model answered from the fed
    // chunks but emitted no inline citation markers.
    'chat.sources': 'Quellen',
    // SourceViewer
    'chat.sourceViewer': 'Quellenansicht',
    'chat.chunkFallback': 'Chunk #{id}',
    'chat.highlightHintTitle': '{snippets}\n(klicken, um zur nächsten Markierung zu springen)',
    'chat.highlightOne': '1 Markierung',
    'chat.highlightMany': '{count} Markierungen',
    'chat.closeSourceViewer': 'Quellenansicht schließen',
    'chat.closeEsc': 'Schließen (Esc)',
    'chat.documentPreview': 'Dokumentvorschau',
    'chat.noChunks': 'Keine Chunks für dieses Dokument vorhanden.',
    // MultiPagePdfPreview
    'chat.pdfPreviewFailed': 'PDF-Vorschau fehlgeschlagen: {message}',
    'chat.loadingPdf': 'PDF wird geladen…',
    'chat.pageLabel': 'S. {n}',
    'chat.rendering': 'Wird gerendert…',
  },
}

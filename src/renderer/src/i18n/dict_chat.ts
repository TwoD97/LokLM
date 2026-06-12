// chat domain strings. Keys are 'chat.*' , English-first , EN is the fallback.
// Owned by the i18n agent for this domain — fill both en + de.
import type { DomainDict } from './types'

export const chatDict: DomainDict = {
  en: {
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
    'chat.stagePrefill': 'Prefill',
    'chat.metricsPipeline': 'pipeline {ms} · ',
    'chat.metricsTtft': 'TTFT {s} s',
    'chat.metricsTokensPerSec': ' · {rate} tok/s',
    'chat.metricsTokens': ' · {count} tok',
    // Grounding badge — per-answer citation trust signal
    'chat.groundingOne': 'Grounded · 1 source',
    'chat.groundingMany': 'Grounded · {count} sources',
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
    'chat.stagePrefill': 'Prefill',
    'chat.metricsPipeline': 'Pipeline {ms} · ',
    'chat.metricsTtft': 'TTFT {s} s',
    'chat.metricsTokensPerSec': ' · {rate} Tok/s',
    'chat.metricsTokens': ' · {count} Tok',
    // Grounding badge — per-answer citation trust signal
    'chat.groundingOne': 'Belegt · 1 Quelle',
    'chat.groundingMany': 'Belegt · {count} Quellen',
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

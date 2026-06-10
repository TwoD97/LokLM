// settings domain strings. Keys are 'settings.*' , English-first , EN is the fallback.
// Owned by the i18n agent for this domain — fill both en + de.
import type { DomainDict } from './types'

export const settingsDict: DomainDict = {
  en: {
    // SettingsModal — tabs
    'settings.loading': 'Loading…',
    'settings.tab.profile': 'Profile',
    'settings.tab.basic': 'Basic',
    'settings.tab.advanced': 'Advanced',
    'settings.tab.about': 'About',

    // BasicTab
    'settings.basic.uiLanguage': 'Interface language',
    'settings.basic.uiLanguageSub': 'Language of the app interface.',
    'settings.basic.theme': 'Theme',
    'settings.basic.themeSub': 'Colour theme of the app. System follows your OS.',
    'settings.basic.themeSystem': 'System',
    'settings.basic.themeLight': 'Light',
    'settings.basic.themeDark': 'Dark',
    'settings.basic.responseLanguage': 'Response language',
    'settings.basic.responseLanguageSub':
      'Auto replies in the language you write in (DE/EN). Pick one to lock it.',
    'settings.basic.languageAuto': 'Auto',
    'settings.basic.pipelineChecklist': 'Pipeline checklist',
    'settings.basic.pipelineChecklistSub':
      'Keep the retrieve / rerank / prefill checklist visible above the answer after the first token. Off by default — it collapses into the metrics line.',
    'settings.basic.pipelineCollapse': 'Collapse on first token',
    'settings.basic.pipelineKeepVisible': 'Keep visible',
    'settings.basic.pipelineVisibility': 'Pipeline checklist visibility',
    'settings.basic.modelSize': 'Model size',
    'settings.basic.fallbackTag': 'fallback',
    'settings.basic.modelSizeSubFallback': 'Loads on demand if Ollama becomes unreachable.',
    'settings.basic.modelSizeSub': 'Which bundled GGUF the local LLM loads.',
    'settings.basic.ollamaNotice':
      "External Ollama is the active LLM source. The bundled model isn't loaded right now — it spins up only if Ollama fails. Pick the profile you'd want serving when that happens.",
    'settings.basic.badgeAuto': 'auto',
    'settings.basic.badgeAvailable': 'available',
    'settings.basic.badgeMissing': 'download via Models panel',
    'settings.basic.reloadConfirmTitle': 'Reload model?',
    'settings.basic.reloadConfirmBody':
      'Switching to the {profile} profile reloads the local model (unload + load). This can take a few seconds to a couple of minutes depending on size.',
    'settings.basic.reloadConfirmAction': 'Switch & reload',
    'settings.basic.systemInfo': 'System info',
    'settings.basic.idleTag': 'idle',
    'settings.basic.systemInfoSubIdle':
      'Empty until the local model loads. Total RAM and GPU stay live.',
    'settings.basic.systemInfoSub': 'Live introspection from the planner.',
    'settings.basic.statTotalRam': 'Total RAM',
    'settings.basic.statGpu': 'GPU',
    'settings.basic.statModel': 'Model',
    'settings.basic.statContextSize': 'Context size',
    'settings.basic.statKvCache': 'KV cache',
    'settings.basic.saved': 'saved',

    // AdvancedTab
    'settings.advanced.bannerStrong': "Advanced settings can break LokLM's local-first defaults.",
    'settings.advanced.bannerBody': 'Only change these if you understand the implications. Use',
    'settings.advanced.bannerResetWord': 'Reset advanced',
    'settings.advanced.bannerBodyTail': 'at the bottom to restore safe defaults.',
    'settings.advanced.subtabLlm': 'LLM',
    'settings.advanced.subtabRetrieval': 'Retrieval',
    'settings.advanced.subtabOllama': 'Ollama',
    'settings.advanced.subtabDiagnostics': 'Diagnostics',
    'settings.advanced.subtabBehavior': 'Behavior',

    // BehaviorSection
    'settings.behavior.title': 'Session & behavior',
    'settings.behavior.sub': 'Model handling on conversation switch and automatic lock.',
    'settings.behavior.convSwitch': 'On conversation switch',
    'settings.behavior.convSwitchHint':
      'Keep the model loaded when switching conversations, or unload it to free memory.',
    'settings.behavior.convKeep': 'Keep loaded',
    'settings.behavior.convUnload': 'Unload',
    'settings.behavior.autoLock': 'Auto-lock',
    'settings.behavior.autoLockHint': 'Lock the app after this many minutes of inactivity.',
    'settings.behavior.lock5': '5 min',
    'settings.behavior.lock15': '15 min',
    'settings.behavior.lock60': '60 min',
    'settings.behavior.lockNever': 'Never',

    'settings.advanced.resetCopy':
      'Restores every advanced setting to its default. Profile and Basic stay untouched.',
    'settings.advanced.reset': 'Reset advanced',
    'settings.advanced.resetConfirm': 'Click again to confirm',

    // ProfileTab
    'settings.profile.upload': 'Upload…',
    'settings.profile.orPickPreset': 'Or pick a preset',
    'settings.profile.pickPresetAvatarNum': 'Pick preset avatar {num}',
    'settings.profile.pickPresetAvatar': 'Pick preset avatar',
    'settings.profile.displayName': 'Display name',
    'settings.profile.displayNameSub': '1–40 characters.',
    'settings.profile.displayNameError': 'Display name must be 1–40 characters.',
    'settings.profile.avatarSizeError': 'Avatar must be ≤ 2 MB.',
    'settings.profile.editSave': 'Save (Enter)',
    'settings.profile.editCancel': 'Cancel (Esc)',
    'settings.profile.edit': 'Edit',
    'settings.profile.recovery': 'Recovery',
    'settings.profile.recoverySub': 'Vault is locked behind your passphrase and password.',
    'settings.profile.status': 'Status',
    'settings.profile.recoverySet': 'Recovery passphrase set',
    'settings.profile.saved': 'saved',

    // ReindexGateModal
    'settings.reindex.heading': 'Re-index required',
    'settings.reindex.bodyPre': 'Switching embedder from',
    'settings.reindex.bodyMid': 'to',
    'settings.reindex.bodyPost':
      'changes the embedding model. Existing chunks must be re-embedded; search results will be unavailable until re-indexing finishes.',
    'settings.reindex.busy': 'Re-indexing…',
    'settings.reindex.confirm': 'Re-index now',

    // OllamaSection
    'settings.ollama.title': 'External Ollama',
    'settings.ollama.sub':
      'Power-user opt-in. Connection + model selection for an Ollama HTTP endpoint.',
    'settings.ollama.baseUrl': 'Base URL',
    'settings.ollama.baseUrlHintPre': 'Probes',
    'settings.ollama.baseUrlHintPost': 'on blur. Supports proxies (https + bearer).',
    'settings.ollama.bearerToken': 'Bearer token',
    'settings.ollama.bearerTokenHint': 'Optional. Stored in the encrypted snapshot.',
    'settings.ollama.bearerTokenPlaceholder': '(optional)',
    'settings.ollama.remoteHostWarning': 'External host, data leaves this machine',
    'settings.ollama.remoteHostWarningTitle':
      'Requests leave this machine. The offline principle from the spec is suspended for this.',
    'settings.ollama.probing': 'Probing…',
    'settings.ollama.connected': 'Connected · Ollama v{version} · {count} model',
    'settings.ollama.connectedPlural': 'Connected · Ollama v{version} · {count} models',
    'settings.ollama.remoteGateBlocked':
      'External host blocked. Connection only after password confirmation.',
    'settings.ollama.allowRemoteHost': 'Allow external host…',
    'settings.ollama.probeFailed': 'Failed: {kind} — {message}',
    'settings.ollama.remoteGateMessage': 'External host not authorized.',
    'settings.ollama.llmModel': 'LLM model',
    'settings.ollama.llmModelHint': 'Used for chat answers, titles, and contextualization.',
    'settings.ollama.embedderModel': 'Embedder model',
    'settings.ollama.embedderModelHint': 'Filtered to names matching embed-style patterns.',
    'settings.ollama.showAll': 'show all ({count} more)',
    'settings.ollama.rerankerModel': 'Reranker model',
    'settings.ollama.rerankerModelHint':
      'Ollama has no dedicated reranker — any chat model works (slower).',
    'settings.ollama.useForEverything': 'Use Ollama for everything',
    'settings.ollama.useForEverythingHintReady':
      'Routes LLM, embedding, and reranking through this server. Flips all three sources at once — the per-section toggles below still work if you want to mix-and-match.',
    'settings.ollama.useForEverythingHintNotReady':
      'Pick a model for LLM, Embedder, and Reranker above to enable this switch.',
    'settings.ollama.bundledLocal': 'Bundled (local)',
    'settings.ollama.external': 'External Ollama',
    'settings.ollama.pickAllThree': 'Pick all three Ollama models first',
    'settings.ollama.requestTimeout': 'Request timeout',
    'settings.ollama.requestTimeoutHint':
      'Bound on the request-start latency. The stream itself can take as long as the model needs.',
    'settings.ollama.noMatchingModels': 'No matching models on this Ollama server.',
    'settings.ollama.clickToClear': 'Click to clear',
    'settings.ollama.pickModel': 'Pick {model}',
    'settings.ollama.remoteGateTitle': 'External Ollama host',
    'settings.ollama.remoteGateBody':
      '"{url}" lies outside the local machine. Data therefore leaves the system. Enter your password to confirm — the authorization persists until the URL is reset back to loopback.',
    'settings.ollama.allow': 'Allow',

    // FallbackToast
    'settings.fallback.message': 'Ollama unreachable — used bundled model.',
    'settings.fallback.settings': 'Settings',
    'settings.fallback.dismiss': 'Dismiss',

    // LlmSection
    'settings.llm.title': 'LLM source',
    'settings.llm.sub': 'Where chat answers and titles are generated from.',
    'settings.llm.source': 'Source',
    'settings.llm.sourceHint': 'Bundled is the safe local default.',
    'settings.llm.sourceAria': 'LLM source',
    'settings.llm.bundled': 'Bundled',
    'settings.llm.externalOllama': 'External Ollama',
    'settings.llm.configureOllamaFirst': 'Configure Ollama first',
    'settings.llm.contextSize': 'Context size',
    'settings.llm.contextSizeHint':
      'Auto sizes against free VRAM. Override only if you know your budget.',
    'settings.llm.ctxAuto': 'Auto',

    // EmbedderSection
    'settings.embedder.title': 'Embedder',
    'settings.embedder.sub':
      'Produces the vectors search runs against. Switching forces a re-index.',
    'settings.embedder.source': 'Source',
    'settings.embedder.sourceHint': 'Re-index modal will open when you change this.',
    'settings.embedder.sourceAria': 'Embedder source',
    'settings.embedder.bundled': 'Bundled (BGE-M3)',
    'settings.embedder.externalOllama': 'External Ollama',
    'settings.embedder.pickModelFirst': 'Pick an Ollama embedder model first',
    'settings.embedder.placement': 'Placement',
    'settings.embedder.placementHint': 'CPU/GPU compute placement at load time.',
    'settings.embedder.placementAria': 'Embedder placement',
    'settings.embedder.placementAuto': 'Auto',
    'settings.embedder.placementCpu': 'CPU',
    'settings.embedder.placementGpu': 'GPU',
    'settings.embedder.probeFailed': 'Probe failed ({kind}){msg}',

    // RerankerSection
    'settings.reranker.title': 'Reranker',
    'settings.reranker.sub': 'Re-orders search hits by query relevance before the LLM sees them.',
    'settings.reranker.enabled': 'Reranking',
    'settings.reranker.enabledHint':
      'Off skips the cross-encoder and keeps the fused search order — lighter, slightly less precise.',
    'settings.reranker.enabledAria': 'Reranking on or off',
    'settings.reranker.on': 'On',
    'settings.reranker.off': 'Off',
    'settings.reranker.source': 'Source',
    'settings.reranker.sourceHint': 'Bundled is a real cross-encoder; Ollama prompts a chat model.',
    'settings.reranker.sourceAria': 'Reranker source',
    'settings.reranker.bundled': 'Bundled',
    'settings.reranker.externalOllama': 'External Ollama',
    'settings.reranker.pickModelFirst': 'Pick an Ollama reranker model first',
    'settings.reranker.ollamaWarning':
      "Ollama doesn't expose dedicated rerankers. Scores come from prompting a chat model — slower and less accurate than the bundled cross-encoder.",
    'settings.reranker.placement': 'Placement',
    'settings.reranker.placementHint': 'CPU/GPU compute placement at load time.',
    'settings.reranker.placementAria': 'Reranker placement',
    'settings.reranker.placementAuto': 'Auto',
    'settings.reranker.placementCpu': 'CPU',
    'settings.reranker.placementGpu': 'GPU',

    // IndexingSection
    'settings.indexing.title': 'Indexing & retrieval',
    'settings.indexing.sub':
      'How documents are split into chunks and how many passages are retrieved per question.',
    'settings.indexing.chunkSize': 'Chunk size',
    'settings.indexing.chunkSizeHint': 'Characters per chunk when indexing documents (500–8000).',
    'settings.indexing.overlap': 'Chunk overlap',
    'settings.indexing.overlapHint': 'Characters shared between adjacent chunks (0–500).',
    'settings.indexing.topK': 'Retrieved passages (Top-K)',
    'settings.indexing.topKHint': 'How many passages are pulled into context per question (3–30).',

    // DiagnosticsSection
    'settings.diag.title': 'Diagnostics',
    'settings.diag.sub': "Read-only snapshot of the planner's most recent decisions.",
    'settings.diag.totalRam': 'Total RAM (GB)',
    'settings.diag.gpu': 'GPU',
    'settings.diag.activeModel': 'Active model',
    'settings.diag.recommendedProfile': 'Recommended profile',
    'settings.diag.freeVram': 'Free VRAM (GB)',
    'settings.diag.contextSize': 'Context size',
    'settings.diag.kvCacheType': 'KV cache type',
    'settings.diag.planReason': 'Plan reason',

    // AboutTab
    'settings.about.licenseMit': 'LokLM is released under the MIT License',
    'settings.about.tagline':
      'Local-first knowledge assistant with source verification. Built with the open-source components listed below.',
    'settings.about.npmHeading': 'Bundled software components (Apache-2.0)',
    'settings.about.npmSub':
      'The following npm packages are shipped with LokLM under the Apache License 2.0.',
    'settings.about.modelsHeading': 'Bundled model weights',
    'settings.about.modelsSub':
      'Local LLM and retrieval models downloaded into the models/ directory on first run.',
    'settings.about.showApacheText': 'Apache License 2.0 — full text',
    'settings.about.hideApacheText': 'Hide Apache License notice',
    'settings.about.apacheNote':
      'The full text of the Apache License 2.0 is shipped with the application as THIRD_PARTY_NOTICES.md and is also available at',
    'settings.about.logsHeading': 'Diagnostic logs',
    'settings.about.logsSub':
      'Warnings and errors are written to a file on this machine. Older entries are purged automatically.',
    'settings.about.logsOpen': 'Open log folder',
  },
  de: {
    // SettingsModal — tabs
    'settings.loading': 'Wird geladen…',
    'settings.tab.profile': 'Profil',
    'settings.tab.basic': 'Allgemein',
    'settings.tab.advanced': 'Erweitert',
    'settings.tab.about': 'Über',

    // BasicTab
    'settings.basic.uiLanguage': 'Anzeigesprache',
    'settings.basic.uiLanguageSub': 'Sprache der Benutzeroberfläche.',
    'settings.basic.theme': 'Erscheinungsbild',
    'settings.basic.themeSub': 'Farbschema der App. „System“ folgt dem Betriebssystem.',
    'settings.basic.themeSystem': 'System',
    'settings.basic.themeLight': 'Hell',
    'settings.basic.themeDark': 'Dunkel',
    'settings.basic.responseLanguage': 'Antwortsprache',
    'settings.basic.responseLanguageSub':
      'Auto antwortet in deiner Eingabesprache (DE/EN). Oder fixiere eine.',
    'settings.basic.languageAuto': 'Auto',
    'settings.basic.pipelineChecklist': 'Pipeline-Checkliste',
    'settings.basic.pipelineChecklistSub':
      'Hält die Retrieve- / Rerank- / Prefill-Checkliste nach dem ersten Token über der Antwort sichtbar. Standardmäßig aus — sie klappt in die Metrik-Zeile ein.',
    'settings.basic.pipelineCollapse': 'Beim ersten Token einklappen',
    'settings.basic.pipelineKeepVisible': 'Sichtbar halten',
    'settings.basic.pipelineVisibility': 'Sichtbarkeit der Pipeline-Checkliste',
    'settings.basic.modelSize': 'Modellgröße',
    'settings.basic.fallbackTag': 'Fallback',
    'settings.basic.modelSizeSubFallback':
      'Wird bei Bedarf geladen, falls Ollama nicht erreichbar ist.',
    'settings.basic.modelSizeSub': 'Welches gebündelte GGUF das lokale LLM lädt.',
    'settings.basic.ollamaNotice':
      'Externes Ollama ist die aktive LLM-Quelle. Das gebündelte Modell ist gerade nicht geladen — es startet nur, wenn Ollama ausfällt. Wähle das Profil, das dann bedienen soll.',
    'settings.basic.badgeAuto': 'auto',
    'settings.basic.badgeAvailable': 'verfügbar',
    'settings.basic.badgeMissing': 'über Modelle-Panel laden',
    'settings.basic.reloadConfirmTitle': 'Modell neu laden?',
    'settings.basic.reloadConfirmBody':
      'Der Wechsel auf das Profil {profile} lädt das lokale Modell neu (entladen + laden). Das kann je nach Größe einige Sekunden bis ein paar Minuten dauern.',
    'settings.basic.reloadConfirmAction': 'Wechseln & neu laden',
    'settings.basic.systemInfo': 'Systeminfo',
    'settings.basic.idleTag': 'inaktiv',
    'settings.basic.systemInfoSubIdle':
      'Leer, bis das lokale Modell lädt. Gesamt-RAM und GPU bleiben live.',
    'settings.basic.systemInfoSub': 'Live-Introspektion vom Planner.',
    'settings.basic.statTotalRam': 'Gesamt-RAM',
    'settings.basic.statGpu': 'GPU',
    'settings.basic.statModel': 'Modell',
    'settings.basic.statContextSize': 'Kontextgröße',
    'settings.basic.statKvCache': 'KV-Cache',
    'settings.basic.saved': 'gespeichert',

    // AdvancedTab
    'settings.advanced.bannerStrong':
      'Erweiterte Einstellungen können LokLMs Local-First-Standards aushebeln.',
    'settings.advanced.bannerBody': 'Ändere diese nur, wenn du die Konsequenzen verstehst. Nutze',
    'settings.advanced.bannerResetWord': 'Erweitert zurücksetzen',
    'settings.advanced.bannerBodyTail': 'unten, um sichere Standardwerte wiederherzustellen.',
    'settings.advanced.subtabLlm': 'LLM',
    'settings.advanced.subtabRetrieval': 'Retrieval',
    'settings.advanced.subtabOllama': 'Ollama',
    'settings.advanced.subtabDiagnostics': 'Diagnose',
    'settings.advanced.subtabBehavior': 'Verhalten',

    // BehaviorSection
    'settings.behavior.title': 'Sitzung & Verhalten',
    'settings.behavior.sub': 'Modell-Handhabung beim Konversationswechsel und automatische Sperre.',
    'settings.behavior.convSwitch': 'Beim Konversationswechsel',
    'settings.behavior.convSwitchHint':
      'Modell beim Wechsel geladen lassen oder entladen, um Speicher freizugeben.',
    'settings.behavior.convKeep': 'Geladen lassen',
    'settings.behavior.convUnload': 'Entladen',
    'settings.behavior.autoLock': 'Automatische Sperre',
    'settings.behavior.autoLockHint': 'App nach so vielen Minuten Inaktivität sperren.',
    'settings.behavior.lock5': '5 Min.',
    'settings.behavior.lock15': '15 Min.',
    'settings.behavior.lock60': '60 Min.',
    'settings.behavior.lockNever': 'Nie',

    'settings.advanced.resetCopy':
      'Setzt jede erweiterte Einstellung auf ihren Standard zurück. Profil und Allgemein bleiben unberührt.',
    'settings.advanced.reset': 'Erweitert zurücksetzen',
    'settings.advanced.resetConfirm': 'Zum Bestätigen erneut klicken',

    // ProfileTab
    'settings.profile.upload': 'Hochladen…',
    'settings.profile.orPickPreset': 'Oder wähle eine Vorlage',
    'settings.profile.pickPresetAvatarNum': 'Vorlagen-Avatar {num} wählen',
    'settings.profile.pickPresetAvatar': 'Vorlagen-Avatar wählen',
    'settings.profile.displayName': 'Anzeigename',
    'settings.profile.displayNameSub': '1–40 Zeichen.',
    'settings.profile.displayNameError': 'Anzeigename muss 1–40 Zeichen lang sein.',
    'settings.profile.avatarSizeError': 'Avatar darf höchstens 2 MB groß sein.',
    'settings.profile.editSave': 'Speichern (Enter)',
    'settings.profile.editCancel': 'Abbrechen (Esc)',
    'settings.profile.edit': 'Bearbeiten',
    'settings.profile.recovery': 'Wiederherstellung',
    'settings.profile.recoverySub':
      'Der Vault ist durch deine Passphrase und dein Passwort gesperrt.',
    'settings.profile.status': 'Status',
    'settings.profile.recoverySet': 'Wiederherstellungs-Passphrase gesetzt',
    'settings.profile.saved': 'gespeichert',

    // ReindexGateModal
    'settings.reindex.heading': 'Neuindizierung erforderlich',
    'settings.reindex.bodyPre': 'Der Wechsel des Embedders von',
    'settings.reindex.bodyMid': 'zu',
    'settings.reindex.bodyPost':
      'ändert das Embedding-Modell. Vorhandene Chunks müssen neu eingebettet werden; Suchergebnisse sind erst nach Abschluss der Neuindizierung verfügbar.',
    'settings.reindex.busy': 'Neuindizierung läuft…',
    'settings.reindex.confirm': 'Jetzt neu indizieren',

    // OllamaSection
    'settings.ollama.title': 'Externes Ollama',
    'settings.ollama.sub':
      'Power-User-Option. Verbindung + Modellauswahl für einen Ollama-HTTP-Endpunkt.',
    'settings.ollama.baseUrl': 'Basis-URL',
    'settings.ollama.baseUrlHintPre': 'Prüft',
    'settings.ollama.baseUrlHintPost':
      'beim Verlassen des Felds. Unterstützt Proxies (https + Bearer).',
    'settings.ollama.bearerToken': 'Bearer-Token',
    'settings.ollama.bearerTokenHint': 'Optional. Wird im verschlüsselten Snapshot gespeichert.',
    'settings.ollama.bearerTokenPlaceholder': '(optional)',
    'settings.ollama.remoteHostWarning': 'Externer Host, Daten verlassen diesen Rechner',
    'settings.ollama.remoteHostWarningTitle':
      'Anfragen verlassen diesen Rechner. Lastenheft-Grundsatz (offline) ist hierfür ausgesetzt.',
    'settings.ollama.probing': 'Prüfe…',
    'settings.ollama.connected': 'Verbunden · Ollama v{version} · {count} Modell',
    'settings.ollama.connectedPlural': 'Verbunden · Ollama v{version} · {count} Modelle',
    'settings.ollama.remoteGateBlocked':
      'Externer Host blockiert. Verbindung erst nach Passwort-Bestätigung.',
    'settings.ollama.allowRemoteHost': 'Externen Host erlauben…',
    'settings.ollama.probeFailed': 'Fehlgeschlagen: {kind} — {message}',
    'settings.ollama.remoteGateMessage': 'Externer Host nicht freigegeben.',
    'settings.ollama.llmModel': 'LLM-Modell',
    'settings.ollama.llmModelHint':
      'Wird für Chat-Antworten, Titel und Kontextualisierung genutzt.',
    'settings.ollama.embedderModel': 'Embedder-Modell',
    'settings.ollama.embedderModelHint': 'Gefiltert auf Namen mit Embed-typischen Mustern.',
    'settings.ollama.showAll': 'alle anzeigen ({count} weitere)',
    'settings.ollama.rerankerModel': 'Reranker-Modell',
    'settings.ollama.rerankerModelHint':
      'Ollama hat keinen dedizierten Reranker — jedes Chat-Modell funktioniert (langsamer).',
    'settings.ollama.useForEverything': 'Ollama für alles nutzen',
    'settings.ollama.useForEverythingHintReady':
      'Leitet LLM, Embedding und Reranking über diesen Server. Schaltet alle drei Quellen auf einmal um — die Schalter pro Abschnitt unten funktionieren weiterhin, falls du mischen willst.',
    'settings.ollama.useForEverythingHintNotReady':
      'Wähle oben ein Modell für LLM, Embedder und Reranker, um diesen Schalter zu aktivieren.',
    'settings.ollama.bundledLocal': 'Gebündelt (lokal)',
    'settings.ollama.external': 'Externes Ollama',
    'settings.ollama.pickAllThree': 'Wähle zuerst alle drei Ollama-Modelle',
    'settings.ollama.requestTimeout': 'Anfrage-Timeout',
    'settings.ollama.requestTimeoutHint':
      'Grenze für die Latenz des Anfragestarts. Der Stream selbst darf so lange dauern, wie das Modell braucht.',
    'settings.ollama.noMatchingModels': 'Keine passenden Modelle auf diesem Ollama-Server.',
    'settings.ollama.clickToClear': 'Zum Leeren klicken',
    'settings.ollama.pickModel': '{model} wählen',
    'settings.ollama.remoteGateTitle': 'Externer Ollama-Host',
    'settings.ollama.remoteGateBody':
      '"{url}" liegt außerhalb des lokalen Rechners. Daten verlassen damit das System. Passwort zur Bestätigung eingeben — die Freigabe gilt persistent, bis die URL wieder auf Loopback zurückgesetzt wird.',
    'settings.ollama.allow': 'Erlauben',

    // FallbackToast
    'settings.fallback.message': 'Ollama nicht erreichbar — gebündeltes Modell verwendet.',
    'settings.fallback.settings': 'Einstellungen',
    'settings.fallback.dismiss': 'Schließen',

    // LlmSection
    'settings.llm.title': 'LLM-Quelle',
    'settings.llm.sub': 'Woraus Chat-Antworten und Titel erzeugt werden.',
    'settings.llm.source': 'Quelle',
    'settings.llm.sourceHint': 'Gebündelt ist der sichere lokale Standard.',
    'settings.llm.sourceAria': 'LLM-Quelle',
    'settings.llm.bundled': 'Gebündelt',
    'settings.llm.externalOllama': 'Externes Ollama',
    'settings.llm.configureOllamaFirst': 'Zuerst Ollama einrichten',
    'settings.llm.contextSize': 'Kontextgröße',
    'settings.llm.contextSizeHint':
      'Auto bemisst sich am freien VRAM. Nur überschreiben, wenn du dein Budget kennst.',
    'settings.llm.ctxAuto': 'Auto',

    // EmbedderSection
    'settings.embedder.title': 'Embedder',
    'settings.embedder.sub':
      'Erzeugt die Vektoren, gegen die die Suche läuft. Ein Wechsel erzwingt eine Neuindizierung.',
    'settings.embedder.source': 'Quelle',
    'settings.embedder.sourceHint': 'Beim Ändern öffnet sich der Neuindizierungs-Dialog.',
    'settings.embedder.sourceAria': 'Embedder-Quelle',
    'settings.embedder.bundled': 'Gebündelt (BGE-M3)',
    'settings.embedder.externalOllama': 'Externes Ollama',
    'settings.embedder.pickModelFirst': 'Wähle zuerst ein Ollama-Embedder-Modell',
    'settings.embedder.placement': 'Platzierung',
    'settings.embedder.placementHint': 'CPU/GPU-Rechenplatzierung beim Laden.',
    'settings.embedder.placementAria': 'Embedder-Platzierung',
    'settings.embedder.placementAuto': 'Auto',
    'settings.embedder.placementCpu': 'CPU',
    'settings.embedder.placementGpu': 'GPU',
    'settings.embedder.probeFailed': 'Prüfung fehlgeschlagen ({kind}){msg}',

    // RerankerSection
    'settings.reranker.title': 'Reranker',
    'settings.reranker.sub':
      'Ordnet Suchtreffer nach Anfrage-Relevanz neu, bevor das LLM sie sieht.',
    'settings.reranker.enabled': 'Reranking',
    'settings.reranker.enabledHint':
      'Aus überspringt den Cross-Encoder und behält die fusionierte Trefferreihenfolge — leichter, etwas ungenauer.',
    'settings.reranker.enabledAria': 'Reranking an oder aus',
    'settings.reranker.on': 'An',
    'settings.reranker.off': 'Aus',
    'settings.reranker.source': 'Quelle',
    'settings.reranker.sourceHint':
      'Gebündelt ist ein echter Cross-Encoder; Ollama promptet ein Chat-Modell.',
    'settings.reranker.sourceAria': 'Reranker-Quelle',
    'settings.reranker.bundled': 'Gebündelt',
    'settings.reranker.externalOllama': 'Externes Ollama',
    'settings.reranker.pickModelFirst': 'Wähle zuerst ein Ollama-Reranker-Modell',
    'settings.reranker.ollamaWarning':
      'Ollama bietet keine dedizierten Reranker. Die Scores stammen aus dem Prompten eines Chat-Modells — langsamer und ungenauer als der gebündelte Cross-Encoder.',
    'settings.reranker.placement': 'Platzierung',
    'settings.reranker.placementHint': 'CPU/GPU-Rechenplatzierung beim Laden.',
    'settings.reranker.placementAria': 'Reranker-Platzierung',
    'settings.reranker.placementAuto': 'Auto',
    'settings.reranker.placementCpu': 'CPU',
    'settings.reranker.placementGpu': 'GPU',

    // IndexingSection
    'settings.indexing.title': 'Indexierung & Suche',
    'settings.indexing.sub':
      'Wie Dokumente in Chunks geteilt werden und wie viele Passagen pro Frage abgerufen werden.',
    'settings.indexing.chunkSize': 'Chunkgröße',
    'settings.indexing.chunkSizeHint': 'Zeichen pro Chunk beim Indexieren (500–8000).',
    'settings.indexing.overlap': 'Überlappung',
    'settings.indexing.overlapHint': 'Gemeinsame Zeichen zwischen benachbarten Chunks (0–500).',
    'settings.indexing.topK': 'Abgerufene Passagen (Treffer-K)',
    'settings.indexing.topKHint':
      'Wie viele Passagen pro Frage in den Kontext geholt werden (3–30).',

    // DiagnosticsSection
    'settings.diag.title': 'Diagnose',
    'settings.diag.sub': 'Schreibgeschützte Momentaufnahme der jüngsten Planner-Entscheidungen.',
    'settings.diag.totalRam': 'Gesamt-RAM (GB)',
    'settings.diag.gpu': 'GPU',
    'settings.diag.activeModel': 'Aktives Modell',
    'settings.diag.recommendedProfile': 'Empfohlenes Profil',
    'settings.diag.freeVram': 'Freier VRAM (GB)',
    'settings.diag.contextSize': 'Kontextgröße',
    'settings.diag.kvCacheType': 'KV-Cache-Typ',
    'settings.diag.planReason': 'Plan-Begründung',

    // AboutTab
    'settings.about.licenseMit': 'LokLM steht unter der MIT-Lizenz',
    'settings.about.tagline':
      'Local-First-Wissensassistent mit Quellenverifikation. Gebaut mit den unten gelisteten Open-Source-Komponenten.',
    'settings.about.npmHeading': 'Gebündelte Software-Komponenten (Apache-2.0)',
    'settings.about.npmSub':
      'Die folgenden npm-Pakete werden mit LokLM unter der Apache License 2.0 ausgeliefert.',
    'settings.about.modelsHeading': 'Gebündelte Modell-Gewichte',
    'settings.about.modelsSub':
      'Lokale LLM- und Retrieval-Modelle, die beim ersten Start in das Verzeichnis models/ geladen werden.',
    'settings.about.showApacheText': 'Apache License 2.0 — vollständiger Text',
    'settings.about.hideApacheText': 'Apache-Lizenz-Hinweis ausblenden',
    'settings.about.apacheNote':
      'Der vollständige Text der Apache License 2.0 wird als THIRD_PARTY_NOTICES.md mit der Anwendung ausgeliefert und ist außerdem verfügbar unter',
    'settings.about.logsHeading': 'Diagnose-Protokolle',
    'settings.about.logsSub':
      'Warnungen und Fehler werden in eine Datei auf diesem Rechner geschrieben. Ältere Einträge werden automatisch entfernt.',
    'settings.about.logsOpen': 'Log-Ordner öffnen',
  },
}
